// Library representations chosen without the program asking (BACKLOG C47):
// a program that puts and looks up a lot gets L76's tree for Map and
// prints what the definition prints; equal, show and compare on maps see
// the entries, not the tree's shape; a program with a map inside another
// value keeps the definition.

import { test } from "node:test";
import assert from "node:assert/strict";
import { B } from "../src/prelude.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { runMain } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { withLibraryRepresentations } from "../src/lang/library-reps.ts";
import { COMPARE, CONS, NIL, PAIR_V, S, SHOW_ANY } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

// Counts n words, then shows, compares and tests maps built in two orders.
function program(n: number, nested = false) {
  const k = new Lang(LIBRARY.code);
  const counts = k.def("counts");
  k.define(counts, k.fold(k.call(S.range, k.lit(n)), [
    { variant: NIL, names: [], body: () => k.x(L("empty map")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "counted"], body: ([i], [, m]) => k.let("word", k.call(S.mod, k.call(B.mul, i, k.lit(7919)), k.lit(Math.max(1, Math.floor(n / 3)))), (w) =>
      k.call(L("put"), m!, w, k.call(B.add, k.call(S.first, k.thunk(() => k.call(L("value at"), m!, w)), k.thunk(() => k.lit(0))), k.lit(1)))) },
  ]));
  const of = (...kv: [string, number][]) => k.call(L("as map"), k.list(...kv.map(([a, b]) => k.call(PAIR_V, k.lit(a), k.lit(b)))));
  // The same entries put in another order: a tree of another shape.
  const ab = k.def("ab"), ba = k.def("ba");
  k.define(ab, of(["a", 1], ["b", 2], ["c", 3], ["d", 4]));
  k.define(ba, k.call(L("put"), k.call(L("put"), k.call(L("put"), k.call(L("put"), k.x(L("empty map")), k.lit("d"), k.lit(4)), k.lit("c"), k.lit(3)), k.lit("b"), k.lit(2)), k.lit("a"), k.lit(1)));
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    show(k.call(L("map size"), k.x(counts))),
    show(k.call(S.first, k.thunk(() => k.call(L("value at"), k.x(counts), k.lit(5))), k.thunk(() => k.lit(-1)))),
    show(k.x(ab)),
    show(k.call(S.equal, k.x(ab), k.x(ba))),
    show(k.call(COMPARE, k.x(ab), k.call(L("remove key"), k.x(ba), k.lit("d")))),
    ...(nested ? [show(k.list(k.x(ab), k.x(ba)))] : []),
  )));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, main, own: [counts, ab, ba, main] };
}
// `insiders`: a representation's definitions, which may build a Map.
const printed = (code: ReturnType<typeof program>["code"], names: Record<Id, string>, main: Id, insiders: Id[] = []) => {
  const info = infer(code, names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...insiders] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lines: string[] = [];
  runMain(code, info, main, { print: (s) => lines.push(s), names });
  return lines;
};

test("a word count gets the tree, and prints what the definition prints: equal, show and compare see the entries", () => {
  const p = program(300);
  const info = infer(p.code, p.names, undefined, checkOptions);
  const c = withLibraryRepresentations(p.code, info, p.names, p.main, p.own);
  assert.deepEqual(c.chosen, ["Map as weight-balanced tree"]);
  const plain = printed(p.code, p.names, p.main);
  assert.deepEqual(printed(c.code, c.names, p.main, c.insiders), plain);
  assert.equal(plain[3], "true");
});

test("a program with a map inside another value keeps the definition", () => {
  const p = program(30, true);
  const info = infer(p.code, p.names, undefined, checkOptions);
  assert.deepEqual(withLibraryRepresentations(p.code, info, p.names, p.main, p.own).chosen, []);
});

test("a representations.json row for Map wins", () => {
  const p = program(30);
  const info = infer(p.code, p.names, undefined, checkOptions);
  const row = { name: "mine", of: "std.map", type: "std.map", meaning: null, canonical: true, impl: {}, cost: {} };
  assert.deepEqual(withLibraryRepresentations(p.code, info, p.names, p.main, p.own, [row]).chosen, []);
});

test("the represented program compiles: JavaScript prints the same, and WebAssembly and C take the counts on the tree", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { compile } = await import("../../compiler/src/compile.ts");
  const { lowerScalar } = await import("../../compiler/src/scalar.ts");
  const { emitC } = await import("../../compiler/src/c.ts");
  const { emitWasm } = await import("../../compiler/src/wasm.ts");
  const p = program(300);
  const c = withLibraryRepresentations(p.code, infer(p.code, p.names, undefined, checkOptions), p.names, p.main, p.own);
  const info = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
  const path = join(mkdtempSync(join(tmpdir(), "library-reps-")), "p.js");
  writeFileSync(path, compile(c.code, info, c.names, { runtime, exports: ["main"] }));
  const lines: string[] = [];
  (await import(runtime)).$setPrint((s: string) => lines.push(s));
  ((await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>).main();
  assert.deepEqual(lines, printed(p.code, p.names, p.main));
  // The counts on the tree (show isn't in WebAssembly or C yet, so not main).
  const lowered = lowerScalar(c.code, info, c.names, [p.own[0]], { data: true });
  assert.deepEqual([...lowered.refused.values()], []);
  assert.deepEqual([...emitC(lowered).refused.values()], []);
  assert.ok(WebAssembly.validate(emitWasm(lowered).bytes));
});
