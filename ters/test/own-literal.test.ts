// A number written where a type of the program's own goes (BACKLOG L204b,
// INTERFACES.md "from a fraction"): through its Literal's from fraction,
// given the number as top/bottom, so 2 at a quaternion is 2 + 0i + 0j +
// 0k and 0.25 at a version is from fraction(1, 4). A record of Float64s
// with none still gets the number in every part; any other type with none
// is told where the number is written. Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARITH, ARITHMETIC_V, INT_OPS, LITERAL_V, S, SHOW_ANY } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { INT, NUMBER } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function program(literals: boolean) {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const num = () => k.tref(NUMBER);
  const Q = k.type("Quaternion", [], [["quaternion", [["w", num], ["x", num], ["y", num], ["z", num]]]]);
  const q = (...ps: number[]) => k.call(Q.v.quaternion, ...ps.map((p) => k.lit(p)));
  const parts = (v: Id, f: (...ps: Id[]) => Id, s = "") => k.match(v, [{ variant: Q.v.quaternion, names: ["w", "x", "y", "z"].map((n) => n + s), body: (ps) => f(...ps) }]);
  const m = (a: Id, b: Id) => k.call(B.mul, a, b), p = (a: Id, b: Id) => k.call(B.add, a, b), s = (a: Id, b: Id) => k.call(B.sub, a, b);
  const times = def("hamilton product", () => k.fn(["a", "b"], (a, b) => parts(a, (a1, b1, c1, d1) => parts(b, (a2, b2, c2, d2) => k.call(Q.v.quaternion,
    s(s(s(m(a1, a2), m(b1, b2)), m(c1, c2)), m(d1, d2)),
    s(p(p(m(a1, b2), m(b1, a2)), m(c1, d2)), m(d1, c2)),
    p(p(s(m(a1, c2), m(b1, d2)), m(c1, a2)), m(d1, b2)),
    p(s(p(m(a1, d2), m(b1, c2)), m(c1, b2)), m(d1, a2))), "₂"))));
  const each = (op: Id) => k.fn(["a", "b"], (a, b) => k.call(S.zipParts, k.x(op), a, b));
  def("arithmetic at quaternion", () => k.call(ARITHMETIC_V, each(B.add), each(B.sub), k.x(times), k.fn(["a"], (a) => k.call(S.mapParts, k.x(B.neg), a))));
  // A version of whole numbers, whose number is major/minor as written.
  const V = k.type("Version", [], [["version", [["major", () => k.tref(INT)], ["minor", () => k.tref(INT)]]]]);
  const vparts = (v: Id, f: (a: Id, b: Id) => Id, s = "") => k.match(v, [{ variant: V.v.version, names: ["major" + s, "minor" + s], body: ([a, b]) => f(a, b) }]);
  const vop = (op: Id) => k.fn(["a", "b"], (a, b) => vparts(a, (a1, b1) => vparts(b, (a2, b2) => k.call(V.v.version, k.call(op, a1, a2), k.call(op, b1, b2)), "₂")));
  def("arithmetic at version", () => k.call(ARITHMETIC_V, vop(INT_OPS.add), vop(INT_OPS.sub), vop(INT_OPS.mul), k.fn(["a"], (a) => vparts(a, (x, y) => k.call(V.v.version, k.call(INT_OPS.neg, x), k.call(INT_OPS.neg, y))))));
  if (literals) {
    def("literal at quaternion", () => k.call(LITERAL_V, k.fn(["top", "bottom"], (t, b) => k.call(Q.v.quaternion, k.call(lib("divided or"), k.call(INT_OPS.toNumber, t), k.call(INT_OPS.toNumber, b), k.lit(0)), k.lit(0), k.lit(0), k.lit(0)))));
    def("literal at version", () => k.call(LITERAL_V, k.fn(["top", "bottom"], (t, b) => k.call(V.v.version, t, b))));
    def("a quarter version", () => k.call(SHOW_ANY, k.call(ARITH.add, k.call(V.v.version, k.int(1), k.int(1)), k.lit(0.25))));
  }
  def("two i", () => k.call(SHOW_ANY, k.call(ARITH.mul, k.lit(2), q(0, 1, 0, 0))));
  def("i plus one", () => k.call(SHOW_ANY, k.call(ARITH.add, q(0, 1, 0, 0), k.lit(1))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions) };
}

async function values(p: ReturnType<typeof program>, at: string[]) {
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const evaluated = at.map((n) => r.value(p.code.defs.find((d) => p.names[d] === n)!));
  const path = join(mkdtempSync(join(tmpdir(), "own-literal-")), "own.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: at }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(at.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => unknown)() : defs[n])), evaluated);
  return evaluated;
}

test("2 at a quaternion with a Literal is 2 + 0i + 0j + 0k, and 0.25 at a version is from fraction(1, 4)", async () => {
  assert.deepEqual(await values(program(true), ["two i", "i plus one", "a quarter version"]), ["quaternion(0, 2, 0, 0)", "quaternion(1, 1, 0, 0)", "version(2, 5)"]);
});

test("with no Literal a record of Float64s still gets the number in every part, and another type is told where", async () => {
  // 2 in every part, under Hamilton's product: why a quaternion wants a Literal.
  assert.deepEqual(await values(program(false), ["two i", "i plus one"]), ["quaternion(-2, 2, 2, -2)", "quaternion(1, 2, 1, 1)"]);
  const k = new Lang(LIBRARY.code);
  const V = k.type("Version", [], [["version", [["major", () => k.tref(INT)], ["minor", () => k.tref(INT)]]]]);
  const same = () => k.fn(["a", "b"], (a) => k.match(a, [{ variant: V.v.version, names: ["x", "y"], body: ([x, y]) => k.call(V.v.version, x, y) }]));
  const ar = k.def("arithmetic at version");
  k.define(ar, k.call(ARITHMETIC_V, same(), same(), same(), k.fn(["a"], (a) => k.match(a, [{ variant: V.v.version, names: ["x", "y"], body: ([x, y]) => k.call(V.v.version, x, y) }]))));
  const d = k.def("bumped");
  k.define(d, k.call(ARITH.add, k.call(V.v.version, k.int(1), k.int(2)), k.lit(1)));
  const code = base(k.code), names = baseNames(k.names);
  const errors = infer(code, names, undefined, checkOptions).errors.map((e) => e.message);
  assert.deepEqual(errors, ["a number written where Version goes needs Version's own from fraction, since it isn't a record of Float64s: give it one, a definition of type Literal Version"]);
});
