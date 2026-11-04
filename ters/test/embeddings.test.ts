// Embeddings (EMBEDDINGS.md, L208b): std's Embedding a b, declared at most
// once for a pair of known types, and its laws (embed-laws.ts) checked on
// small values: the library's five keep + − · and <, a wrong map doesn't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { embeddingLaws, embeddingsIn } from "../src/lang/embed-laws.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { COMPLEX_V, EMBEDDING_V, INT_OPS } from "../src/lang/std.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
const near = lib("near");

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
