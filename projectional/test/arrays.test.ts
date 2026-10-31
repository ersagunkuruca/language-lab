// std's Array (BACKLOG C30d, REPRESENTATIONS.md step 5): a list's items side
// by side, read by position. Its builtins run the same in the evaluator and
// in compiled JS, and equal tells arrays of different lengths apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARRAY_OPS, S, SHOW_ANY } from "../src/lang/std.ts";
import { compile } from "../../compiler/src/compile.ts";
import { showType } from "../src/lang/types.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

test("Array: built, pushed, read by position and turned back into a list, evaluated and compiled", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  type Id = string;
  const nums = (...xs: number[]) => k.list(...xs.map((x) => k.lit(x)));
  const arr = def("arr", () => k.call(ARRAY_OPS.push, k.call(ARRAY_OPS.of, nums(10, 20, 30)), k.lit(40)));
  const names: string[] = [];
  const show = (name: string, x: () => Id) => { names.push(name); def(name, () => k.call(SHOW_ANY, x())); };
  show("the array", () => k.x(arr));
  show("its length", () => k.call(ARRAY_OPS.length, k.x(arr)));
  show("item 2", () => k.call(S.optional, k.thunk(() => k.call(ARRAY_OPS.at, k.x(arr), k.int(2)))));
  show("item 9", () => k.call(S.optional, k.thunk(() => k.call(ARRAY_OPS.at, k.x(arr), k.int(9)))));
  show("its items", () => k.call(ARRAY_OPS.items, k.x(arr)));
  show("empty", () => k.call(ARRAY_OPS.length, k.call(ARRAY_OPS.empty)));
  show("shorter differs", () => k.call(S.equal, k.call(ARRAY_OPS.of, nums(1)), k.call(ARRAY_OPS.of, nums(1, 2))));
  show("same items", () => k.call(S.equal, k.call(ARRAY_OPS.push, k.call(ARRAY_OPS.of, nums(1)), k.lit(2)), k.call(ARRAY_OPS.of, nums(1, 2))));
  // The two ends (C30d): first, rest and push front.
  show("its first", () => k.call(S.optional, k.thunk(() => k.call(ARRAY_OPS.first, k.x(arr)))));
  show("empty's first", () => k.call(S.optional, k.thunk(() => k.call(ARRAY_OPS.first, k.call(ARRAY_OPS.empty)))));
  show("its rest", () => k.call(ARRAY_OPS.rest, k.x(arr)));
  show("empty's rest", () => k.call(ARRAY_OPS.length, k.call(ARRAY_OPS.rest, k.call(ARRAY_OPS.empty))));
  show("pushed in front", () => k.call(ARRAY_OPS.pushFront, k.call(ARRAY_OPS.rest, k.x(arr)), k.lit(5)));
  show("the array after", () => k.x(arr));
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.match(showType(info.subst.zonk(info.typeOf.get(arr)!), nm), /^Array /);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const got = names.map((n) => r.value(code.defs.find((d) => nm[d] === n)!));
  assert.deepEqual(got, ["array [10, 20, 30, 40]", "4", "some(30)", "none", "[10, 20, 30, 40]", "0", "false", "true", "some(10)", "none", "array [20, 30, 40]", "0", "array [5, 20, 30, 40]", "array [10, 20, 30, 40]"]);
  const path = join(mkdtempSync(join(tmpdir(), "arrays-")), "arrays.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: names }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(names.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), got);
});
