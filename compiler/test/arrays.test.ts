// Arrays in compiled JS (C30d): a view on a buffer with room at both ends
// (runtime.js, Ersagun's two-ended array list). An array never changes:
// two pushes onto one array give two arrays, each with its own last item,
// and the evaluator's answers. A push onto the newest array writes into
// the free slot, so a million pushes take linear time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { makeRunner } from "../../projectional/src/lang/run.ts";
import { base, baseNames, checkOptions } from "../../projectional/src/lang/load.ts";
import { LIBRARY } from "../../projectional/src/lang/library.ts";
import { ARRAY_OPS, CONS, INT_OPS, NIL, SHOW_ANY } from "../../projectional/src/lang/std.ts";
import { compile } from "../src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;

test("an array pushed twice gives two arrays, and a long run of pushes is linear", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => string) => { const d = k.def(name); k.define(d, body()); return d; };
  const of = (...xs: number[]) => k.call(ARRAY_OPS.of, k.list(...xs.map((x) => k.int(x))));
  const push = (a: string, x: number) => k.call(ARRAY_OPS.push, a, k.int(x));
  const names: string[] = [];
  const show = (name: string, x: () => string) => { names.push(name); def(name, () => k.call(SHOW_ANY, x())); };
  const base2 = def("base", () => push(of(1, 2), 3));
  show("pushed 4", () => push(k.x(base2), 4));
  show("pushed 5", () => push(k.x(base2), 5));
  show("both", () => k.list(push(push(k.x(base2), 6), 7), push(k.x(base2), 8), k.x(base2)));
  show("from empty", () => push(push(k.call(ARRAY_OPS.empty), 1), 2));
  // n pushes onto the array before: 0, 1, …, n − 1.
  const count = def("count", () => k.fn(["n"], (n) => k.fold(k.call(INT_OPS.range, n), [
    { variant: NIL, names: [], body: () => k.call(ARRAY_OPS.empty) },
    { variant: CONS, names: ["i", "t"], results: [null, "a"], body: ([i], [, a]) => k.call(ARRAY_OPS.push, a!, i) },
  ])));
  const lengthOf = def("length after", () => k.fn(["n"], (n) => k.call(ARRAY_OPS.length, k.call(count, n))));
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const want = names.map((n) => r.value(code.defs.find((d) => nm[d] === n)!));
  assert.deepEqual(want, ["array [1, 2, 3, 4]", "array [1, 2, 3, 5]", "[array [1, 2, 3, 6, 7], array [1, 2, 3, 8], array [1, 2, 3]]", "array [1, 2]"]);
  const path = join(mkdtempSync(join(tmpdir(), "arrays-")), "arrays.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: [...names, "count", "length after"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(names.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => unknown)() : defs[n])), want);
  // A copy per push would take minutes; free slots take milliseconds.
  const t = performance.now();
  assert.equal(Number((defs["length after"] as (n: number) => unknown)(1_000_000)), 1_000_000);
  assert.ok(performance.now() - t < 5_000, `${performance.now() - t} ms`);
});
