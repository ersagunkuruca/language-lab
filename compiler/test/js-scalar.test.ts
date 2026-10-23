// The scalar profile printed as JavaScript: the CPU's way to draw a picture
// whose colour is a record. Numbers are f64 there too, so it must give the
// evaluator's numbers exactly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lowerScalar } from "../src/scalar.ts";
import { loadJs } from "../src/js-scalar.ts";
import { load } from "../src/program.ts";
import { makeRunner } from "../../projectional/src/lang/run.ts";

const first = <T>(xs: Iterable<T>) => { for (const x of xs) return x; };

test("examples/raymarch: colour as JavaScript gives exactly the evaluator's colour", () => {
  const p = load("raymarch");
  const colour = p.named("colour");
  const lowered = lowerScalar(p.code, p.info, p.pres.names, [colour], { records: true });
  assert.deepEqual([...lowered.refused.keys()], []);
  const js = loadJs(lowered).get(colour)!;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const t of [0, 1.5, 4]) for (const x of [-0.9, -0.3, 0.2, 0.8]) for (const y of [-0.7, 0, 0.6]) {
    const want = (first(r.call(r.value(colour), x, y, t)) as { fields: number[] }).fields;
    assert.deepEqual(js(x, y, t), want, `at ${x}, ${y}, ${t}`);
  }
});

test("examples/shaders: red, green and blue as JavaScript", () => {
  const p = load("shaders");
  const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs);
  const js = loadJs(lowered);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const c of ["red", "green", "blue"]) {
    const f = js.get(p.named(c))!;
    for (const [x, y, t] of [[0.1, 0.2, 0], [-0.5, 0.7, 2.5]]) assert.equal(f(x, y, t), first(r.call(r.value(p.named(c)), x, y, t)), c);
  }
});
