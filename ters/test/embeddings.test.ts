// Embeddings (EMBEDDINGS.md, L208b): std's Embedding a b, declared at most
// once for a pair of known types, and its laws (embed-laws.ts) checked on
// small values: the library's five keep + − · and <, a wrong map doesn't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { Lang } from "../src/lang/dsl.ts";
import { embeddingLaws, embeddingsIn } from "../src/lang/embed-laws.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { ARITH, COMPLEX_V, EMBEDDING_V, INT_OPS, SHOW_ANY } from "../src/lang/std.ts";
import { runMain } from "../src/lang/run.ts";
import { B } from "../src/prelude.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
const near = lib("near");
const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function program(build: (k: Lang) => void) {
  const k = new Lang(LIBRARY.code);
  build(k);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  return { code, names, info, own: new Set(Object.keys(k.code.nodes)) };
}

test("the library's embeddings keep + − · and <, the ones each pair of types has", () => {
  const p = program(() => {});
  const found = embeddingsIn(p.info).map((e) => p.names[e.def]).sort();
  assert.deepEqual(found, ["float64 in complex", "float64 in dual", "int in float64", "int in rational", "rational in float64"]);
  const laws = embeddingLaws(p.code, p.info, p.names, undefined, near);
  assert.deepEqual(laws.filter((l) => l.error || l.failures.length).map((l) => l.name), []);
  assert.equal(laws.filter((l) => l.embedding === "float64 in complex").map((l) => l.law).join(" "), "+ − · negation");
  assert.equal(laws.filter((l) => l.embedding === "int in rational").length, 5);
});

test("a map that doesn't keep the operations fails its laws: rational in complex as q + i", () => {
  const p = program((k) => {
    const d = k.def("rational in complex");
    k.define(d, k.call(EMBEDDING_V, k.fn(["q"], (q) => k.call(COMPLEX_V, k.call(lib("as float64"), q), k.lit(1)))));
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const laws = embeddingLaws(p.code, p.info, p.names, p.own, near);
  const failed = laws.filter((l) => l.failures.length).map((l) => l.law);
  assert.deepEqual(failed, ["+", "−", "·", "negation"]);
});

test("an embedding is between two known types, once a pair, written as the record", () => {
  const errors = (build: (k: Lang) => void) => program(build).info.errors.map((e) => e.message);
  const twice = (k: Lang) => { const d = k.def("mine"); k.define(d, k.call(EMBEDDING_V, k.x(INT_OPS.toNumber))); };
  assert.ok(errors(twice).some((m) => /int in float64 and mine both embed Int in Float64: a type goes into another one way/.test(m)), String(errors(twice)));
  const open = (k: Lang) => { const d = k.def("anything"); k.define(d, k.call(EMBEDDING_V, k.fn(["x"], (x) => x))); };
  assert.ok(errors(open).some((m) => /anything is an embedding, so both its types are known ones/.test(m)), String(errors(open)));
  const self = (k: Lang) => { const d = k.def("same"); k.define(d, k.call(EMBEDDING_V, k.fn(["x"], (x) => k.call(INT_OPS.add, x, k.int(0))))); };
  assert.ok(errors(self).some((m) => /same embeds Int in itself/.test(m)), String(errors(self)));
});

// The checker inserts a canonical embedding (L208c): where a known type is
// given for another it embeds in, and on the smaller side of + − · <.
test("an Int given where a Float64 goes, and Int + Float64, go through int in float64", () => {
  const p = program((k) => {
    const half = k.def("half");
    k.define(half, k.fn(["x"], (x) => k.call(B.mul, x, k.lit(0.5))));
    const count = k.def("count");
    k.define(count, k.int(3));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(SHOW_ANY, k.listOf(k.call(half, k.x(count)), k.call(ARITH.add, k.x(count), k.call(half, k.lit(1)))))));
    const less = k.def("less");
    k.define(less, k.thunk(() => k.call(SHOW_ANY, k.call(ARITH.less, k.call(half, k.lit(5)), k.x(count)))));
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.equal(p.info.embedded?.size, 3);
  const main = p.code.defs.find((d) => p.names[d] === "main")!;
  assert.equal(runMain(p.code, p.info, main, { print: () => {}, names: p.names }), "[1.5, 3.5]");
  const less = p.code.defs.find((d) => p.names[d] === "less")!;
  assert.equal(runMain(p.code, p.info, less, { print: () => {}, names: p.names }), "true");
});

test("Int + Rational lifts the Int through int in rational: 3 + 1/1 is 4, in the evaluator and compiled JavaScript", async () => {
  const p = program((k) => {
    const count = k.def("count");
    k.define(count, k.int(3));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(SHOW_ANY, k.call(ARITH.add, k.x(count), k.call(lib("as fraction"), k.int(1))))));
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const main = p.code.defs.find((d) => p.names[d] === "main")!;
  assert.equal(runMain(p.code, p.info, main, { print: () => {}, names: p.names }), "4");
  const path = join(mkdtempSync(join(tmpdir(), "embed-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, "4");
});
