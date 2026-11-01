// Tuples of ports (PORTS-2026-11-01.md §1, BACKLOG L128a): a function's
// inputs are one tuple, so f(p) is f(x, y) when p is an (x, y); a function
// gives several results as a tuple. Checked, evaluated and compiled the
// same (spread.ts takes the tuple apart before anything runs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Id } from "../../ters/src/model.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { ARITH, tuplePart, tupleVariant } from "../../ters/src/lang/std.ts";
import { showType } from "../../ters/src/lang/types.ts";
import { compile } from "../src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;

function program() {
  const k = new Lang();
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  // Two results: a tuple.
  const sd = def("sum and difference", () => k.fn(["x", "y"], (x, y) => k.call(tupleVariant(2), k.call(ARITH.add, x, y), k.call(ARITH.sub, x, y))));
  const scaled = def("scaled", () => k.fn(["x", "y", "by"], (x, y, by) => k.call(ARITH.add, k.call(ARITH.mul, x, by), k.call(ARITH.mul, y, by))));
  const mul = def("times", () => k.fn(["a", "b"], (a, b) => k.call(ARITH.mul, a, b)));
  // Its results given whole to a function of two inputs: a name, then a call.
  def("product of sum and difference", () => k.fn(["x", "y"], (x, y) => k.let("p", k.call(sd, x, y), (p) => k.call(mul, p))));
  def("straight through", () => k.fn(["x", "y"], (x, y) => k.call(mul, k.call(sd, x, y))));
  def("three", () => k.fn(["x"], (x) => k.call(scaled, k.call(tupleVariant(3), x, k.lit(1), k.lit(2)))));
  def("second part", () => k.fn(["x", "y"], (x, y) => k.call(tuplePart(2, 1), k.call(sd, x, y))));
  return { k, code: base(k.code), names: baseNames(k.names), sd };
}

test("a tuple given for several inputs: checked, evaluated and compiled the same", async () => {
  const { code, names, sd } = program();
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(showType(info.typeOf.get(sd)!, names, info.subst.arith), "(a, a) -> (a, a) where a is a Number");
  const exports = ["product of sum and difference", "straight through", "three", "second part"];
  const js = compile(code, info, names, { runtime, exports });
  const path = join(mkdtempSync(join(tmpdir(), "tuples-")), "tuples.js");
  writeFileSync(path, js);
  const out = (await import(pathToFileURL(path).href)).defs as Record<string, (...x: number[]) => unknown>;
  const r = makeRunner(code, info, { print: () => {}, names });
  const at = (n: string) => code.defs.find((d) => names[d] === n)!;
  const first = (v: unknown) => (v && typeof v === "object" && Symbol.iterator in (v as object) ? [...(v as Iterable<unknown>)][0] : v);
  // (5 + 2)(5 − 2) = 21; scaled(2, 1, 2) = 2·2 + 1·2 = 6; 5 − 2 = 3.
  const want: Record<string, number> = { "product of sum and difference": 21, "straight through": 21, "three": 6, "second part": 3 };
  for (const n of exports) {
    const args = n === "three" ? [2] : [5, 2];
    assert.equal(first(r.call(r.value(at(n)), ...(args as never[]))), want[n], `evaluated ${n}`);
    assert.equal(out[n](...args), want[n], `compiled ${n}`);
  }
});

test("a tuple of the wrong shape, or a value that isn't one, says what the inputs need", () => {
  const k = new Lang();
  const mul = k.def("times");
  k.define(mul, k.fn(["a", "b"], (a, b) => k.call(ARITH.mul, a, b)));
  const bad = k.def("bad");
  k.define(bad, k.fn(["x"], (x) => k.call(mul, k.call(tupleVariant(3), x, x, x))));
  const text = k.def("text");
  k.define(text, k.fn(["x"], () => k.call(mul, k.lit("no"))));
  const info = infer(base(k.code), baseNames(k.names), undefined, checkOptions);
  const msgs = info.errors.map((e) => e.message);
  assert.equal(msgs.length, 2, msgs.join("\n"));
  assert.match(msgs[0], /takes 2 inputs: given one, it needs \(a, a\) here, got \(.*, .*, .*\)/);
  assert.match(msgs[1], /takes 2 inputs: given one, it needs \(a, a\) here, got Text/);
});
