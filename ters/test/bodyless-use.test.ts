// A use with no body (L211, PORTS-2026-11-01.md §3 "Decided (L179)"):
// it gives the ports it produces, the ones not given, as a tuple in port
// order, or the one value when it produces one.
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import assert from "node:assert/strict";
import type { Code, Id, NodeOf } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
async function compiled(p: ReturnType<typeof program>): Promise<unknown> {
  const path = join(mkdtempSync(join(tmpdir(), "bodyless-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  return typeof defs.main === "function" ? defs.main() : defs.main;
}

// main is `show(f(given))`, the use written with no body.
function program(build: (k: Lang) => { fn: Id; given: Record<string, Id> }) {
  const k = new Lang();
  const { fn, given } = build(k);
  const main = k.def("main");
  const use = k.useOf(fn, given);
  k.define(main, k.thunk(() => k.call(SHOW_ANY, use)));
  const code: Code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  return { code, names, info, main, use };
}

test("a use that produces one port is its value: add with 2 and out = 5 given is 3", async () => {
  const p = program((k) => ({ fn: B.add, given: { 0: k.lit(2), out: k.lit(5) } }));
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.equal(showType(p.info.typeOf.get(p.use)!, p.names), "Float64");
  assert.equal(runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), "3");
  assert.equal(await compiled(p), "3");
});

test("a use that produces two ports is their tuple, in port order: polar gives x, y", async () => {
  const p = program((k) => {
    const polar = k.def("polar");
    k.define(polar, k.fn(["length", "angle", "x", "y"], (r, t, x, y) => k.and(k.equal(x, k.call(B.mul, r, k.call(B.cos, t))), k.equal(y, k.call(B.mul, r, k.call(B.sin, t))))));
    k.results(polar, "x", "y");
    const [r, t] = (k.code.nodes[(k.code.nodes[polar] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
    return { fn: polar, given: { [r]: k.lit(2), [t]: k.lit(0), out: k.true } };
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.match(showType(p.info.typeOf.get(p.use)!, p.names), /^\(Float64, Float64\)|Tuple2/);
  assert.equal(runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), "(2, 0)");
  assert.equal(await compiled(p), "(2, 0)");
});

// The checker types a use that load didn't fill (L211c): the same type as
// the filled one, from its ports alone.
function unfilled(build: (k: Lang) => { fn: Id; given: Record<string, Id> }) {
  const k = new Lang();
  const { fn, given } = build(k);
  const main = k.def("main");
  const use = k.useOf(fn, given);
  k.define(main, k.thunk(() => k.call(SHOW_ANY, use)));
  const code: Code = base(k.code), names = baseNames(k.names);
  code.nodes[use] = k.code.nodes[use];
  const info = infer(code, names);
  const run = () => runMain(code, info, main, { print: () => {}, names });
  return { info, names, use, node: code.nodes[use] as NodeOf<"call">, run };
}

test("the checker types a use with no body by its produced ports, one or a tuple, and the evaluator runs it", () => {
  const one = unfilled((k) => ({ fn: B.add, given: { 0: k.lit(2), out: k.lit(5) } }));
  assert.equal(one.node.body, undefined);
  assert.deepEqual(one.info.errors.map((e) => e.message), []);
  assert.equal(showType(one.info.typeOf.get(one.use)!, one.names), "Float64");
  // The evaluator runs it too (L211d).
  assert.equal(one.run(), "3");
  const two = unfilled((k) => {
    const polar = k.def("polar");
    k.define(polar, k.fn(["length", "angle", "x", "y"], (r, t, x, y) => k.and(k.equal(x, k.call(B.mul, r, k.call(B.cos, t))), k.equal(y, k.call(B.mul, r, k.call(B.sin, t))))));
    k.results(polar, "x", "y");
    const [r, t] = (k.code.nodes[(k.code.nodes[polar] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
    return { fn: polar, given: { [r]: k.lit(2), [t]: k.lit(0), out: k.true } };
  });
  assert.deepEqual(two.info.errors.map((e) => e.message), []);
  assert.match(showType(two.info.typeOf.get(two.use)!, two.names), /^\(Float64, Float64\)|Tuple2/);
  assert.equal(two.run(), "(2, 0)");
});

test("a use with no body inside a relation is read with its ports bound (L211e): x = 10 − y given y = 3 is 7", () => {
  const k = new Lang();
  const rel = k.def("rest of ten");
  let inner = "";
  k.define(rel, k.fn(["x", "y"], (x, y) => { inner = k.useOf(B.add, { 0: y, out: k.lit(10) }); return k.equal(x, inner); }));
  k.results(rel, "x");
  const [, y] = (k.code.nodes[(k.code.nodes[rel] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  const main = k.def("main");
  const use = k.useOf(rel, { [y]: k.lit(3), out: k.true });
  k.define(main, k.thunk(() => k.call(SHOW_ANY, use)));
  const code: Code = base(k.code), names = baseNames(k.names);
  for (const u of [inner, use]) code.nodes[u] = k.code.nodes[u];
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(runMain(code, info, main, { print: () => {}, names }), "7");
});
