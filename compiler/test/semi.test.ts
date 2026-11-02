// A function given a lambda that has at most one answer (it may fail, C84):
// map's copy for it calls the lambda the single way (`r = f(x); if r is no
// answer…`) and is itself single, so mapping a fail-able lambda over a long
// list neither builds a stream per item nor overflows the stack. Before,
// map's copy was a generator for any Choice function (sheet's cells_between,
// GAPS S3). Prior art: Mercury's semidet determinism.
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
import { S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { compile } from "../src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const lib = (n: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === n)!;

test("map given a lambda that may fail runs single-style, compiled as evaluated (C84)", async () => {
  const k = new Lang(LIBRARY.code);
  const kept = k.def("kept below");
  k.define(kept, k.fn(["n", "top"], (n, top) => k.call(S.all, k.thunk(() =>
    k.call(lib("map"), k.call(S.range, n), k.fn(["x"], (x) => k.if(k.call(S.less, x, top), x, k.call(S.fail))))))));
  const all = k.def("all kept"), none = k.def("none kept");
  k.define(all, k.call(SHOW_ANY, k.call(kept, k.lit(5000), k.lit(6000))));
  k.define(none, k.call(SHOW_ANY, k.call(kept, k.lit(5000), k.lit(10))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const source = compile(code, info, names, { runtime, exports: ["all kept", "none kept"] });
  assert.match(source, /map\$choice\$one\(/);
  const path = join(mkdtempSync(join(tmpdir(), "semi-")), "m.js");
  writeFileSync(path, source);
  const out = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  const run = makeRunner(code, info, { print: () => {}, names });
  const got = (name: string) => typeof out[name] === "function" ? (out[name] as () => unknown)() : out[name];
  assert.deepEqual(got("all kept"), run.value(all));
  assert.deepEqual(got("none kept"), run.value(none));
  assert.equal(got("none kept"), "[]");
});
