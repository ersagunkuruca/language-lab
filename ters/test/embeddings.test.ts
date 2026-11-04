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
import { loadCoreJs, lowerCore } from "../../compiler/src/core-js.ts";
import { Lang } from "../src/lang/dsl.ts";
import { embeddingLaws, embeddingsIn } from "../src/lang/embed-laws.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import type { Id } from "../src/model.ts";
import { ARITH, COMPLEX_V, EMBEDDING_V, INT_OPS, S, SHOW_ANY, TEXT_OPS } from "../src/lang/std.ts";
import { runMain } from "../src/lang/run.ts";
import { relate } from "../src/lang/relate.ts";
import { RATIO } from "../src/lang/std.ts";
import type { Pins } from "../src/lang/signatures.ts";
import { INT, NUMBER, type Type } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
const near = lib("near");
const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

// build may give pins (signatures.ts) for its definitions.
function program(build: (k: Lang) => void | Pins) {
  const k = new Lang(LIBRARY.code);
  const pins = build(k);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, pins ? { ...checkOptions, pins } : checkOptions);
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
    // Int now goes into Complex through Rational and through Float64, so
    // the way meant is declared (the diamond rule, L208d).
    const i = k.def("int in complex");
    k.define(i, k.call(EMBEDDING_V, k.fn(["n"], (n) => k.call(COMPLEX_V, k.call(INT_OPS.toNumber, n), k.lit(0)))));
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const laws = embeddingLaws(p.code, p.info, p.names, p.own, near);
  const failed = laws.filter((l) => l.failures.length).map((l) => l.law);
  // It also disagrees with going through Float64, and int in complex with
  // going through it (the diamond rule, L208d).
  assert.deepEqual(failed, ["+", "−", "·", "negation", "as rational in float64 then float64 in complex", "as int in rational then rational in complex"]);
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

// L208c2: a function given where one with a larger result is wanted has
// its result lifted, a lambda's body where it is and a named function
// through (x) → map(f(x)).
test("a function returning Int given where one returning Float64 goes: its result is lifted", async () => {
  const p = program((k) => {
    const halfOf = k.def("half of");
    k.define(halfOf, k.fn(["f"], (f) => k.call(B.mul, k.call(f, k.lit("abc")), k.lit(0.5))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(SHOW_ANY, k.listOf(
      k.call(halfOf, k.x(TEXT_OPS.length)),
      k.call(halfOf, k.fn(["t"], (t) => k.call(INT_OPS.add, k.call(TEXT_OPS.length, t), k.int(2))))))));
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.equal(p.info.embedded?.size, 2);
  const main = p.code.defs.find((d) => p.names[d] === "main")!;
  assert.equal(runMain(p.code, p.info, main, { print: () => {}, names: p.names }), "[1.5, 2.5]");
  const path = join(mkdtempSync(join(tmpdir(), "embed-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, "[1.5, 2.5]");
  // And JavaScript printed from the core IR.
  const l = lowerCore(p.code, p.info, p.names, [main]);
  assert.deepEqual([...l.refused.values()], []);
  const fs = loadCoreJs(l);
  assert.equal(fs[l.funcs.findIndex((g) => g.name === "main" && !g.inner)](), "[1.5, 2.5]");
});

// A wanted type known only from an earlier input (L208c3): inverse(half,
// count) wants a Float64 second because half gives one, so the Int count
// is lifted once the call doesn't fit as it is, and the search runs on 3.0.
test("an Int given where an earlier input says a Float64 goes is lifted: inverse(half, count) is 6", async () => {
  const p = program((k) => {
    const half = k.def("half");
    k.define(half, k.fn(["x"], (x) => k.call(B.mul, x, k.lit(0.5))));
    const count = k.def("count");
    k.define(count, k.int(3));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(SHOW_ANY, k.call(S.first, k.thunk(() => k.call(lib("inverse"), k.x(half), k.x(count))), k.thunk(() => k.lit(-1))))));
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.equal(p.info.embedded?.size, 1);
  const main = p.code.defs.find((d) => p.names[d] === "main")!;
  assert.equal(runMain(p.code, p.info, main, { print: () => {}, names: p.names }), "6");
  const path = join(mkdtempSync(join(tmpdir(), "embed-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, "6");
  // Text given there has no embedding into Float64: still an error.
  const q = program((k) => {
    const half = k.def("half");
    k.define(half, k.fn(["x"], (x) => k.call(B.mul, x, k.lit(0.5))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(SHOW_ANY, k.call(S.first, k.thunk(() => k.call(lib("inverse"), k.x(half), k.lit("3"))), k.thunk(() => k.lit(-1))))));
  });
  assert.match(q.info.errors.map((e) => e.message).join("\n"), /needs Float64 here, got Text/);
});

// A pinned definition's own result (L208c4): a Float64 pinned, the body an
// Int, and a function pinned to give a Float64 whose body gives an Int.
test("a definition pinned to a Float64 whose body gives an Int is lifted: 3 and 4", async () => {
  const float: Type = { t: "con", id: NUMBER, args: [] }, int: Type = { t: "con", id: INT, args: [] };
  const pin = (type: Type) => ({ vars: [], rows: [], type, plain: [] });
  const p = program((k) => {
    const count = k.def("count");
    k.define(count, k.int(3));
    const ratio = k.def("ratio");
    k.define(ratio, k.x(count));
    const next = k.def("next");
    k.define(next, k.fn(["n"], (n) => k.call(INT_OPS.add, n, k.int(1))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(SHOW_ANY, k.listOf(k.call(ARITH.mul, k.x(ratio), k.lit(1)), k.call(ARITH.mul, k.call(next, k.x(count)), k.lit(1))))));
    return { [ratio]: pin(float), [next]: pin({ t: "fn", params: [int], ret: float, eff: { effs: [], tail: null } }) };
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.equal(p.info.embedded?.size, 2);
  const main = p.code.defs.find((d) => p.names[d] === "main")!;
  assert.equal(runMain(p.code, p.info, main, { print: () => {}, names: p.names }), "[3, 4]");
  const path = join(mkdtempSync(join(tmpdir(), "embed-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, "[3, 4]");
  // A Text body has no embedding into Float64: the pin is still broken.
  const q = program((k) => {
    const ratio = k.def("ratio");
    k.define(ratio, k.lit("3"));
    return { [ratio]: pin(float) };
  });
  assert.match(q.info.errors.map((e) => e.message).join("\n"), /ratio is pinned to Float64, and this makes it Text/);
});

// A search sees the lifts too (L208g): its evaluator resolves the
// resolved code again, which once wrapped a lift twice, making the call
// its own input (out of memory).
test("a backwards search through a lifted Int: add fractions(x, count) at x = 1/2 is 7/2", () => {
  const p = program((k) => {
    const count = k.def("count");
    k.define(count, k.int(3));
    const g = k.def("g");
    k.define(g, k.fn(["x"], (x) => k.call(lib("add fractions"), x, k.x(count))));
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const g = p.code.defs.find((d) => p.names[d] === "g")!;
  const x = (p.code.nodes[(p.code.nodes[g] as { body: Id }).body] as { params: Id[] }).params[0];
  let steps = 0;
  const [answer] = relate(p.code, g, { [x]: { tag: RATIO, fields: [1, 2] } }, { info: p.info, names: p.names, spend: () => ++steps < 20000 });
  assert.deepEqual(answer?.values.out, { tag: RATIO, fields: [7, 2] });
});

// The diamond rule (L208d, diamonds.ts): two paths between the same types
// need a direct embedding, which the laws test checks against each path.
test("the library's int in float64 agrees with int in rational then rational in float64", () => {
  const p = program(() => {});
  const laws = embeddingLaws(p.code, p.info, p.names, undefined, near).filter((l) => l.law.startsWith("as "));
  assert.deepEqual(laws.map((l) => `${l.embedding}: ${l.law}`), ["int in float64: as int in rational then rational in float64"]);
  assert.deepEqual(laws.filter((l) => l.error || l.failures.length), []);
});

test("two ways from one type into another with no direct one are refused, and a direct one settles it", () => {
  // Four one-field records of an Int: p goes into q and r, each into s.
  const build = (direct: boolean) => (k: Lang) => {
    const made = Object.fromEntries(["p", "q", "r", "s"].map((n) => [n, k.type(n.toUpperCase(), [], [[n, [["n", () => k.tref("type.int")]]]])]));
    const field = (name: string) => made[name].f[`${name}.n`];
    const variant = (name: string) => made[name].v[name];
    const into = (from: string, to: string) => {
      const d = k.def(`${from} in ${to}`);
      k.define(d, k.call(EMBEDDING_V, k.fn(["x"], (x) => k.call(variant(to), k.call(field(from), x)))));
    };
    into("p", "q"); into("p", "r"); into("q", "s"); into("r", "s");
    if (direct) into("p", "s");
  };
  const refused = program(build(false)).info.errors.map((e) => e.message);
  assert.ok(refused.some((m) => /P goes into S 2 ways \(through Q, through R\), and they may not agree: declare an embedding from P to S/.test(m)), String(refused));
  const settled = program(build(true));
  assert.deepEqual(settled.info.errors.map((e) => e.message), []);
  const laws = embeddingLaws(settled.code, settled.info, settled.names, settled.own, near).filter((l) => l.law.startsWith("as "));
  assert.deepEqual(laws.map((l) => `${l.embedding}: ${l.law}`).sort(), ["p in s: as p in q then q in s", "p in s: as p in r then r in s"]);
});
