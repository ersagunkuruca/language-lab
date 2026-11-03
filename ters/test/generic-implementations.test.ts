// Implementations with type parameters (L219): one `Arithmetic (Pair a)`
// for any a that has a + − · −x of its own, as Haskell's instance contexts
// (Wadler and Blott, POPL 1989). A pair of Float64s and a pair of Ints add
// through the same implementation; a pair of Texts has none, and the
// checker says so. Evaluated and compiled alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { ARITH, ARITHMETIC_V, SHOW_ANY } from "../src/lang/std.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

// Duo a = duo(a, a), its + − · −x part by part through a's own.
function program(main: (k: Lang, duo: (x: Id, y: Id) => Id) => Id) {
  const k = new Lang(LIBRARY.code);
  const D = k.type("Duo", ["a"], [["duo", [["left", (_s, [a]) => k.tref(a)], ["right", (_s, [a]) => k.tref(a)]]]]);
  const duo = (x: Id, y: Id) => k.call(D.v.duo, x, y);
  const parts = (v: Id, f: (l: Id, r: Id) => Id, s = "") => k.match(v, [{ variant: D.v.duo, names: ["l" + s, "r" + s], body: ([l, r]) => f(l, r) }]);
  const two = (op: Id) => k.fn(["a", "b"], (a, b) => parts(a, (l1, r1) => parts(b, (l2, r2) => duo(k.call(op, l1, l2), k.call(op, r1, r2)), "₂")));
  const d = k.def("arithmetic at duo");
  k.define(d, k.call(ARITHMETIC_V, two(ARITH.add), two(ARITH.sub), two(ARITH.mul), k.fn(["a"], (a) => parts(a, (l, r) => duo(k.call(ARITH.neg, l), k.call(ARITH.neg, r))))));
  const m = k.def("main");
  k.define(m, k.thunk(() => k.call(SHOW_ANY, main(k, duo))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), main: m };
}
async function both(p: ReturnType<typeof program>) {
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const v = runMain(p.code, p.info, p.main, { print: () => {}, names: p.names });
  const path = join(mkdtempSync(join(tmpdir(), "generic-impl-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, v);
  return v;
}

test("one Arithmetic (Duo a) adds duos of Float64s and of Ints, each through its own +", async () => {
  assert.match(await both(program((k, duo) => k.call(ARITH.add, duo(k.lit(1.5), k.lit(2)), duo(k.lit(0.25), k.lit(3))))) as string, /1\.75.*5/);
  assert.match(await both(program((k, duo) => k.call(ARITH.mul, duo(k.int(6), k.int(7)), duo(k.int(7), k.int(6))))) as string, /42.*42/);
});

test("a duo of Texts has no + : its parts have none", () => {
  const p = program((k, duo) => k.call(ARITH.add, duo(k.lit("a"), k.lit("b")), duo(k.lit("c"), k.lit("d"))));
  assert.ok(p.info.errors.length > 0);
  assert.match(p.info.errors.map((e) => e.message).join("; "), /Text/);
});
