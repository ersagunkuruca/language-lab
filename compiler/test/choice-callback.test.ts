// A library definition given a Choice function (map with a function that
// has two answers): the library is checked apart, so its body names its
// rows with variables of its own, and its copy for a Choice function must
// switch those on too (compile.ts bodyRho). Before, map's copy called the
// function as if it had one answer and put its stream in the list. A
// page's view may do Choice since L125b, so every view that maps did this.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { CONS, INT_OPS, NIL, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { compile } from "../src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const lib = (n: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === n)!;

test("map given a function with two answers gives every list of answers, compiled as evaluated", async () => {
  const k = new Lang(LIBRARY.code);
  const m = k.def("each way");
  k.define(m, k.call(S.all, k.thunk(() => k.call(SHOW_ANY, k.call(lib("map"), k.list(k.lit(1), k.lit(2)), k.fn(["x"], (x) => k.call(S.oneOf, k.list(x, k.lit(9)))))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const evaluated = makeRunner(code, info, { print: () => {}, names }).value(m);
  const path = join(mkdtempSync(join(tmpdir(), "choice-callback-")), "m.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["each way"] }));
  const out = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  const compiled = typeof out["each way"] === "function" ? (out["each way"] as () => unknown)() : out["each way"];
  assert.deepEqual(compiled, evaluated);
  assert.match(JSON.stringify(evaluated), /"\[1, 2\]".*"\[1, 9\]".*"\[9, 2\]".*"\[9, 9\]"/);
});

// A search whose function input shares its row, `(a) -[Choice, e]-> Bool`,
// given a lambda that doesn't choose and passed on to itself: the copy
// calls it as a stream, since its row names Choice, so the lambda is one
// too (C98). Before, it was written plain and the call threw.
test("a search's function input that shares its row, given a lambda that doesn't choose, compiled as evaluated (C98)", async () => {
  const k = new Lang(LIBRARY.code);
  const helper = k.def("helper");
  k.define(helper, k.fn(["xs", "t"], (xs, t) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["x", "r"], body: ([x, r]) => k.if(k.call(t, x), x, k.call(helper, r, t)) },
  ])));
  const m = k.def("found");
  k.define(m, k.call(SHOW_ANY, k.call(S.all, k.thunk(() => k.call(helper, k.list(k.int(1), k.int(5)), k.fn(["x"], (x) => k.call(INT_OPS.less, k.int(4), x)))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const evaluated = makeRunner(code, info, { print: () => {}, names }).value(m);
  const path = join(mkdtempSync(join(tmpdir(), "choice-callback-")), "m.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["found"] }));
  const out = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  const compiled = typeof out["found"] === "function" ? (out["found"] as () => unknown)() : out["found"];
  assert.deepEqual(compiled, evaluated);
  assert.equal(evaluated, "[5]");
});
