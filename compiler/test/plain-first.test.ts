// `first` with a fallback in the plain scalar profile (C166): a search's
// body whose division has no answer, there or in a definition it calls,
// gives the fallback, as in the evaluator and in a shader; the same
// definition called outside any search still stops. WebAssembly and C;
// JavaScript (js-scalar.ts) runs as the GPU does, its checks dropped, so
// it gives the evaluator's answers where there is one all the way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { B } from "../../ters/src/prelude.ts";
import { S } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { loadJs } from "../src/js-scalar.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";

const first = (xs: Iterable<unknown>) => { for (const x of xs) return x; };

function program() {
  const k = new Lang();
  const shadow = k.def("shadow"), colour = k.def("colour"), inside = k.def("inside"), bare = k.def("bare");
  // shadow divides: no answer at 0.
  k.define(shadow, k.fn(["x"], (x) => k.call(B.div, k.lit(1), x)));
  // The division in a definition the search calls.
  k.define(colour, k.fn(["x"], (x) => k.call(S.first, k.thunk(() => k.call(B.add, k.call(shadow, x), k.lit(1))), k.thunk(() => k.lit(-1)))));
  // The division right in the search's body.
  k.define(inside, k.fn(["x", "y"], (x, y) => k.call(S.first, k.thunk(() => k.call(B.div, x, y)), k.thunk(() => k.lit(7)))));
  // shadow outside any search: no answer stops.
  k.define(bare, k.fn(["x"], (x) => k.call(B.mul, k.call(shadow, x), k.lit(2))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), shadow, colour, inside, bare };
}

test("first with a fallback in the plain profile: no answer inside gives the fallback, outside stops (C166)", { skip }, async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const roots = [p.colour, p.inside, p.bare];
  const lowered = lowerScalar(p.code, p.info, p.names, roots, {});
  assert.deepEqual([...lowered.refused.values()], []);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const ev = (d: string, ...xs: number[]) => first(r.call(r.value(d), ...(xs as never[])));
  const js = loadJs(lowered);
  const wasm = await instantiate(emitWasm(lowered)) as unknown as Record<string, (...xs: number[]) => number>;
  const at = (d: string) => lowered.funcs.findIndex((f) => f.def === d);
  const calls: [number, number[]][] = [];
  for (const x of [2, 0, -4]) calls.push([at(p.colour), [x]]);
  for (const [x, y] of [[6, 3], [1, 0], [0, 0]]) calls.push([at(p.inside), [x, y]]);
  calls.push([at(p.bare), [4]], [at(p.bare), [0]]);
  const c = build(lowered)(calls as never);
  calls.forEach(([i, xs], k) => {
    const d = lowered.funcs[i].def, name = `${lowered.funcs[i].name}(${xs})`;
    if (d === p.bare && xs[0] === 0) {
      // The evaluator has no answer; WebAssembly and C stop with why.
      assert.equal(ev(d, ...xs), undefined, `evaluator ${name}`);
      assert.throws(() => wasm[lowered.funcs[i].name](...xs), /x \/ 0 has no answer/, `WebAssembly ${name}`);
      assert.deepEqual(c[k].value, { aborted: "x / 0 has no answer" }, `C ${name}`);
      return;
    }
    const want = ev(d, ...xs);
    assert.equal(typeof want, "number", `evaluator ${name}`);
    const whole = (d === p.colour && xs[0] !== 0) || (d === p.inside && xs[1] !== 0);
    if (whole) assert.equal(js.get(d)!(...xs), want, `JavaScript ${name}`);
    assert.equal(wasm[lowered.funcs[i].name](...xs), want, `WebAssembly ${name}`);
    assert.equal(c[k].value, want, `C ${name}`);
  });
});
