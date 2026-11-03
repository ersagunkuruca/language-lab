// A written list is one `list of` call with an input per item (L181b,
// I154): compiled JavaScript, the core IR (its JavaScript, WebAssembly and
// C) and staging take it as it is, so ten thousand items are one node, not
// ten thousand nested conses that overflow each pass's stack.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { makeRunner, runMain, type Value } from "../../ters/src/lang/run.ts";
import { CONS, NIL, S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { stageProgram } from "../../ters/src/lang/stage.ts";
import { compile } from "../src/compile.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, fromText, instantiate } from "../src/wasm.ts";
import { emitC } from "../src/c.ts";
import { loadCoreJs, lowerCore } from "../src/core-js.ts";
import { build, skip as noC } from "./c-harness.ts";

const sum = LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === "sum")!;
const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const N = 10_000;
const items = Array.from({ length: N }, (_, i) => (i * 37) % 101);
const want = String(items.reduce((a, b) => a + b, 0));

// main shows the sum of the written list; `total` sums one with an item
// that comes from its input, so nothing folds it away before it's run.
function program() {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main"), total = k.def("total"), addUp = k.def("add up");
  // A loop (a tail call): the library's sum recurs as deep as the list on
  // the core IR's JavaScript, which is C137's, not this.
  k.define(addUp, k.fn(["xs", "acc"], (xs, acc) => k.match(xs, [
    { variant: NIL, names: [], body: () => acc },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.call(addUp, rest, k.call(B.add, acc, x)) },
  ])));
  k.define(main, k.thunk(() => k.call(S.show, k.call(sum, k.listOf(...items.map((x) => k.lit(x)))))));
  k.define(total, k.fn(["x"], (x) => k.call(addUp, k.listOf(...items.map((v, i) => (i === 5000 ? k.call(B.add, x, k.lit(v)) : k.lit(v)))), k.lit(0))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, main, total };
}
// Checked once for the file: checking ten thousand items takes seconds.
let checked: ReturnType<typeof program> | undefined;
const once = () => (checked ??= program());

test("ten thousand written items in compiled JavaScript", async () => {
  const p = once();
  assert.equal(runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), want);
  const path = join(mkdtempSync(join(tmpdir(), "list-of-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main", "total"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, (...xs: unknown[]) => unknown>;
  assert.equal(defs.main(), want);
  assert.equal(defs.total(1), Number(want) + 1);
});

test("ten thousand written items staged", () => {
  const p = once();
  const s = stageProgram(p.code, p.info, p.names);
  const main = s.code.defs.findLast((d) => s.names[d] === "main")!;
  assert.equal(runMain(s.code, s.info, main, { print: () => {}, names: s.names }), want);
});

test("ten thousand written items on the core IR: its JavaScript, WebAssembly and C", async () => {
  const p = once();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const ev = (x: number) => { for (const v of r.call(r.value(p.total), x)) return v as Value; };
  const core = lowerCore(p.code, p.info, p.names, [p.total]);
  const fs = loadCoreJs(core);
  assert.equal(fs[core.funcs.findIndex((f) => f.def === p.total && !f.inner)](2), ev(2));
  const lowered = lowerScalar(p.code, p.info, p.names, [p.main, p.total], { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const w = await instantiate(emitWasm(lowered)) as unknown as Record<string, (...xs: unknown[]) => unknown>;
  const fm = lowered.funcs.find((f) => f.def === p.main)!, ft = lowered.funcs.find((f) => f.def === p.total)!;
  assert.equal(fromText(w as never, w[fm.name]()), want);
  assert.equal(w[ft.name](3), ev(3));
  if (!noC) {
    assert.deepEqual([...emitC(lowered).refused.entries()], []);
    const got = build(lowered)([[lowered.funcs.indexOf(fm), []], [lowered.funcs.indexOf(ft), [4]]]);
    assert.deepEqual(got.map((g) => g.value), [want, ev(4)]);
  }
});

// The passes that read a list written out (C157) read a `list of` too:
// a shader's array has its size from it, and `one of` a few constants is
// written out in compiled JavaScript.
test("a short `list of`: a shader's array, and one of a few constants", async () => {
  const { ARRAY_OPS } = await import("../../ters/src/lang/std.ts");
  const { loadJs } = await import("../src/js-scalar.ts");
  const { emitWgsl } = await import("../src/wgsl.ts");
  const k = new Lang(LIBRARY.code);
  const palette = k.def("palette"), picks = k.def("picks");
  k.define(palette, k.fn(["i"], (i) => k.call(S.first, k.thunk(() => k.call(ARRAY_OPS.at, k.call(ARRAY_OPS.of, k.listOf(k.lit(0.1), k.lit(0.5), k.lit(0.9))), i)), k.thunk(() => k.lit(-1)))));
  k.define(picks, k.fn(["x"], (x) => k.call(S.all, k.thunk(() => k.call(B.add, x, k.call(S.oneOf, k.listOf(k.lit(1), k.lit(2), k.lit(3))))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const ev = (d: string, ...xs: unknown[]) => { for (const v of r.call(r.value(d), ...(xs as never[]))) return v; };
  const lowered = lowerScalar(code, info, names, [palette], { records: true, shader: true });
  assert.deepEqual([...lowered.refused.values()], []);
  assert.match(emitWgsl(lowered).wgsl, /array<f32, 3>\(0\.1, 0\.5, 0\.9\)/);
  const js = loadJs(lowered);
  for (const i of [-1, 0, 2, 3]) assert.equal(js.get(palette)!(BigInt(i)), ev(palette, BigInt(i)), `palette ${i}`);
  const source = compile(code, info, names, { runtime, exports: ["picks"] });
  const path = join(mkdtempSync(join(tmpdir(), "list-of-")), "picks.mjs");
  writeFileSync(path, source);
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, (x: number) => unknown>;
  assert.deepEqual(defs.picks(10), ev(picks, 10));
  assert.ok(!source.includes("builtin.list.of"), "one of a few constants is written out, not a list made and walked");
});
