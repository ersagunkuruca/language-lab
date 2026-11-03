// + − · −x and < as the interfaces Arithmetic and Ordered (INTERFACES.md
// step 4, BACKLOG L40h): a type of the program's own joins the one + and <
// with an implementation. Quaternions, a record of four Float64s, get
// Hamilton's product instead of the part-by-part one; a version number
// gets an order, so the prelude's `smaller` works on it. Evaluated and
// compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARITH, ARITHMETIC_V, INT_OPS, ORDERED_V, S, SHOW_ANY, SHOWN_V } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { INT, NUMBER } from "../src/lang/types.ts";
import { subtree, type Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program(extra?: (k: Lang, V: { def: Id; v: Record<string, Id> }) => void) {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const num = () => k.tref(NUMBER);
  const Q = k.type("Quaternion", [], [["quaternion", [["w", num], ["x", num], ["y", num], ["z", num]]]]);
  const q = (...ps: number[]) => k.call(Q.v.quaternion, ...ps.map((p) => k.lit(p)));
  const parts = (v: Id, f: (...ps: Id[]) => Id, s = "") => k.match(v, [{ variant: Q.v.quaternion, names: ["w", "x", "y", "z"].map((n) => n + s), body: (ps) => f(...ps) }]);
  const m = (a: Id, b: Id) => k.call(B.mul, a, b), p = (a: Id, b: Id) => k.call(B.add, a, b), s = (a: Id, b: Id) => k.call(B.sub, a, b);
  // Hamilton's product (1843).
  const times = def("hamilton product", () => k.fn(["a", "b"], (a, b) => parts(a, (a1, b1, c1, d1) => parts(b, (a2, b2, c2, d2) => k.call(Q.v.quaternion,
    s(s(s(m(a1, a2), m(b1, b2)), m(c1, c2)), m(d1, d2)),
    s(p(p(m(a1, b2), m(b1, a2)), m(c1, d2)), m(d1, c2)),
    p(p(s(m(a1, c2), m(b1, d2)), m(c1, a2)), m(d1, b2)),
    p(s(p(m(a1, d2), m(b1, c2)), m(c1, b2)), m(d1, a2))), "₂"))));
  const each = (op: Id) => k.fn(["a", "b"], (a, b) => k.call(S.zipParts, k.x(op), a, b));
  def("arithmetic at quaternion", () => k.call(ARITHMETIC_V, each(B.add), each(B.sub), k.x(times), k.fn(["a"], (a) => k.call(S.mapParts, k.x(B.neg), a))));
  const square = def("square", () => k.fn(["v"], (v) => k.call(ARITH.mul, v, v)));
  const show = (x: Id) => k.call(SHOW_ANY, x);
  def("i times j", () => show(k.call(ARITH.mul, q(0, 1, 0, 0), q(0, 0, 1, 0))));
  def("j times i", () => show(k.call(ARITH.mul, q(0, 0, 1, 0), q(0, 1, 0, 0))));
  def("i squared", () => show(k.call(square, q(0, 1, 0, 0))));
  def("a sum", () => show(k.call(ARITH.add, q(1, 2, 3, 4), q(4, 3, 2, 1))));
  // A version number with an order of its own, so smaller works on it.
  const V = k.type("Version", [], [["version", [["major", () => k.tref(INT)], ["minor", () => k.tref(INT)]]]]);
  const ver = (a: number, b: number) => k.call(V.v.version, k.int(a), k.int(b));
  const earlier = def("earlier", () => k.fn(["a", "b"], (a, b) => k.match(a, [{ variant: V.v.version, names: ["m", "n"], body: ([m1, n1]) => k.match(b, [{ variant: V.v.version, names: ["m₂", "n₂"], body: ([m2, n2]) =>
    k.call(S.or, k.call(INT_OPS.less, m1, m2), k.call(S.and, k.call(S.equal, m1, m2), k.call(INT_OPS.less, n1, n2))) }]) }])));
  def("ordered at version", () => k.call(ORDERED_V, k.x(earlier)));
  def("the older", () => show(k.call(lib("smaller"), ver(2, 1), ver(1, 9))));
  extra?.(k, V);
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions) };
}
const NAMES = ["i times j", "j times i", "i squared", "a sum", "the older"];

test("a type's own · and < through the one · and <, evaluated and compiled", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  const evaluated = NAMES.map((n) => r.value(at(n)));
  assert.deepEqual(evaluated, ["quaternion(0, 0, 0, 1)", "quaternion(0, 0, 0, -1)", "quaternion(-1, 0, 0, 0)", "quaternion(5, 5, 5, 5)", "version(1, 9)"]);
  const path = join(mkdtempSync(join(tmpdir(), "own-")), "own.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(NAMES.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated);
});

test("a type with no + or < of its own is told so where it is used", () => {
  const p = program((k, V) => {
    const d = k.def("versions added");
    k.define(d, k.call(ARITH.add, k.call(V.v.version, k.int(1), k.int(0)), k.call(V.v.version, k.int(2), k.int(0))));
  });
  const d = p.code.defs.find((x) => p.names[x] === "versions added")!;
  const inside = new Set(subtree(p.code, d));
  assert.match(p.info.errors.filter((e) => inside.has(e.id)).map((e) => e.message).join("; "), /Version isn't a Number .*and has no \+ − · of its own: give it one, a definition of type Arithmetic Version/);
});

test("a type's own show through Shown: show any shows a version as 1.9 (L205)", () => {
  const p = program((k, V) => {
    const text = k.def("version text");
    k.define(text, k.fn(["v"], (v) => k.match(v, [{ variant: V.v.version, names: ["m", "n"], body: ([m, n]) => k.text(k.call(INT_OPS.show, m), k.lit("."), k.call(INT_OPS.show, n)) }])));
    const d = k.def("shown at version");
    k.define(d, k.call(SHOWN_V, k.x(text)));
    // Inside a search too: run backwards from its text, the version is
    // found by showing each candidate the same way.
    const shows = k.def("shows as");
    k.define(shows, k.fn(["t", "v"], (t, v) => k.and(k.equal(v, k.call(S.oneOf, k.list(k.call(V.v.version, k.int(1), k.int(9)), k.call(V.v.version, k.int(2), k.int(0))))), k.equal(t, k.call(SHOW_ANY, v)))));
    const [t, v] = (k.code.nodes[(k.code.nodes[shows] as { body: Id }).body] as unknown as { params: Id[] }).params;
    const found = k.def("which shows as 2.0");
    k.define(found, k.call(S.first, k.thunk(() => k.solve(shows, { [t]: k.lit("2.0"), out: k.true }, { [v]: "v" }, ({ [v]: x }) => k.call(SHOW_ANY, x))), k.thunk(() => k.lit("none"))));
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  // The quaternion, with no Shown, shows as before.
  assert.equal(r.value(at("the older")), "1.9");
  assert.equal(r.value(at("a sum")), "quaternion(5, 5, 5, 5)");
  assert.equal(r.value(at("which shows as 2.0")), "2.0");
});
