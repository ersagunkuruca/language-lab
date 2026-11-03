// A library type's + − · and < (L204a): looked up from the implementations
// the library itself has, found by its check (the layer under a program,
// L216), not from a list of names in the checker. A library type with one
// waits for the lookup; one without is told so where it is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { checkOnce, infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { ARITH } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
const program = (body: (k: Lang) => Id) => { const k = new Lang(LIBRARY.code); const d = k.def("it"); k.define(d, body(k)); return { code: base(k.code), names: baseNames(k.names) }; };
const errors = (p: ReturnType<typeof program>) => infer(p.code, p.names, undefined, checkOptions).errors.map((e) => e.message);

test("a word's + is the library's implementation, over the kept library and from scratch", () => {
  const p = program((k) => k.call(ARITH.add, k.call(lib("as word8"), k.int(250)), k.call(lib("as word8"), k.int(10))));
  assert.deepEqual(errors(p), []);
  checkOnce(null);
  try { assert.deepEqual(errors(p), []); } finally { checkOnce(LIBRARY.code, LIBRARY.names); }
});

test("a library type with no + is told so where + is used", () => {
  const p = program((k) => k.call(ARITH.add, k.list(k.int(1)), k.list(k.int(2))));
  const e = errors(p);
  assert.equal(e.length, 1);
  assert.match(e[0], /works only on a Number/);
  assert.doesNotMatch(e[0], /of its own/);
});
