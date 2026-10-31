// Which parts of a multivector can be nonzero (GRADES.md, BACKLOG L43b):
// a blade mask per value, read from the algebra's own table. Checked by
// hand on Cl(3, 0) and PGA, and against the evaluator: on inputs inside
// the given masks, a part the mask says is off is always 0.

import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, loadProgram } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { algebrasOf, bladeMask, describeMask } from "../src/lang/grades.ts";
import { ARITH } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

// An algebra with squares, its parts in the order clifford table wants.
function algebra(squares: number[]) {
  const k = new Lang(LIBRARY.code);
  const n = 1 << squares.length;
  const M = k.type("Multivector", [], [["multivector", Array.from({ length: n }, (_, i) => [`p${i}`, () => k.tref(NUMBER)] as [string, () => Id])]]);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const at = (parts: Record<number, number | Id>) => k.call(M.v.multivector, ...Array.from({ length: n }, (_, i) => (typeof parts[i] === "string" ? parts[i] as Id : k.lit((parts[i] as number) ?? 0))));
  const basis = def("basis", () => k.list(...Array.from({ length: n }, (_, i) => at({ [i]: 1 }))));
  const al = def("algebra", () => k.call(lib("clifford algebra"), k.list(...squares.map((x) => k.lit(x))), k.x(basis)));
  const call = (f: string, ...xs: Id[]) => k.call(lib(`clifford ${f}`), k.x(al), ...xs);
  return { k, def, at, call, done: () => { const code = base(k.code), names = { ...baseNames(), ...k.names }; return { code, names, info: infer(code, names) }; } };
}

test("blade masks in Cl(3, 0): vectors, products, rotors and the sandwich", () => {
  const a = algebra([1, 1, 1]);
  const { k, def, at, call } = a;
  // Parts: 1, e1, e2, e12, e3, e13, e23, e123.
  const vec = (x: Id, y: Id, z: Id) => at({ 1: x, 2: y, 4: z });
  const fns = {
    vector: def("vector", () => k.fn(["x", "y", "z"], (x, y, z) => vec(x, y, z))),
    product: def("product", () => k.fn(["x", "y"], (x, y) => call("product", vec(x, y, k.lit(0)), vec(y, x, k.lit(1))))),
    outer: def("outer", () => k.fn(["x", "y"], (x, y) => call("outer", vec(x, y, k.lit(0)), vec(y, x, k.lit(1))))),
    inner: def("inner", () => k.fn(["x"], (x) => call("inner", vec(x, x, x), at({ 3: x })))),
    rotor: def("rotor", () => k.fn(["t"], (t) => call("exp", k.call(lib("scale"), t, at({ 3: 1 }))))),
    turned: def("turned", () => k.fn(["t", "x"], (t, x) => call("sandwich", call("exp", at({ 3: t, 6: x })), vec(x, t, x)))),
    reflected: def("reflected", () => k.fn(["x"], (x) => call("reflect", vec(k.lit(1), x, k.lit(0)), at({ 3: x, 0: x })))),
    grade: def("grade 2", () => k.fn(["x"], (x) => call("grade", k.lit(2), call("product", vec(x, x, x), vec(x, k.lit(1), x))))),
    sum: def("sum", () => k.fn(["x"], (x) => k.call(ARITH.add, vec(x, x, x), at({ 7: x })))),
    given: def("given", () => k.fn(["v", "w"], (v, w) => call("outer", v, w))),
    part: def("with part", () => k.fn(["x"], (x) => call("with part", vec(x, x, x), k.list(k.lit(2), k.lit(1)), k.lit(3)))),
  };
  const { code, names, info } = a.done();
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const alg = [...algebrasOf(code, info).values()][0];
  assert.deepEqual(alg.blades, [[], [1], [2], [1, 2], [3], [1, 3], [2, 3], [1, 2, 3]]);
  const words = (d: Id, given: (number | null)[] = []) => { const r = bladeMask(code, info, d, given); return r && describeMask(r.algebra, r.mask); };
  assert.equal(words(fns.vector), "a vector");
  // A vector times a vector: a scalar and a bivector.
  assert.equal(words(fns.product), "even (a rotor or motor)");
  assert.equal(words(fns.outer), "a bivector");
  // e12 inside: a vector contracted onto e12 gives e1 and e2, nothing on e3.
  assert.equal(words(fns.inner), "e₁, e₂");
  assert.equal(words(fns.rotor), "1, e₁₂");
  assert.equal(words(fns.turned), "a vector");
  assert.equal(words(fns.reflected), "1, e₁₂");
  assert.equal(words(fns.grade), "a bivector");
  assert.equal(words(fns.sum), "odd");
  // Inputs every part unless given: two vectors' outer product is a bivector.
  assert.equal(words(fns.given), "1, e₁, e₂, e₁₂, e₃, e₁₃, e₂₃, e₁₂₃");
  assert.equal(words(fns.given, [0b10110, 0b10110]), "a bivector");
  assert.equal(words(fns.part), "e₁, e₂, e₁₂, e₃");
  void names;
});

test("blade masks in PGA: a product landing on e₀e₀ = 0 drops out", () => {
  // Cl(2, 0, 1): parts 1, e1, e2, e12, e0, e10, e20, e120.
  const a = algebra([1, 1, 0]);
  const { k, def, at, call } = a;
  const ideal = def("ideal", () => k.fn(["x"], (x) => call("product", at({ 4: x }), at({ 4: x, 5: x }))));
  const { code, info } = a.done();
  const r = bladeMask(code, info, ideal)!;
  assert.equal(r.mask, 0);
  assert.equal(describeMask(r.algebra, r.mask), "0");
});

test("blade masks are never too small: Constructions' functions against the evaluator", () => {
  const p = loadProgram("examples/constructions");
  const info = infer(p.code, p.pres.names);
  const own = JSON.parse(readFileSync("examples/constructions/code.json", "utf8")).defs as Id[];
  const id = (n: string) => own.find((d) => p.pres.names[d] === n)!;
  const point = bladeMask(p.code, info, id("point"))!;
  const words = (n: string, given: (number | null)[] = []) => { const r = bladeMask(p.code, info, id(n), given); return r && describeMask(r.algebra, r.mask); };
  assert.equal(describeMask(point.algebra, point.mask), "a bivector");
  // A point turned, mirrored, normalised or halfway is still a point.
  assert.equal(words("normalised", [point.mask]), "a bivector");
  assert.equal(words("turned", [point.mask, point.mask, null]), "a bivector");
  assert.equal(words("midpoint", [point.mask, point.mask]), "a bivector");
  // Soundness: random inputs inside the masks never set a part outside.
  const r = makeRunner(p.code, info, { print: () => {} });
  const tag = point.algebra.variant;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 4 - 2;
  const within = (m: number): Value => ({ tag, fields: Array.from({ length: point.algebra.parts }, (_, i) => ((m >> i) & 1 ? rand() : 0)) });
  const full = point.algebra.full;
  for (const [n, given] of [["join", [point.mask, point.mask]], ["meet", [0b10110, 0b10110]], ["turned", [point.mask, point.mask, null]], ["mirror", [point.mask, 0b10110]], ["perpendicular", [0b10110, point.mask]], ["times", [full, full]], ["wedge", [0b10110, 0b10110]]] as [string, (number | null)[]][]) {
    const got = bladeMask(p.code, info, id(n), given);
    assert.ok(got, n);
    const m = got.mask;
    for (let t = 0; t < 5; t++) {
      const args = given.map((g) => (g === null ? rand() : within(g)));
      const out = first(r.call(r.value(id(n)), ...args) as Iterable<Value>)!;
      // Off means 0 in exact arithmetic: a cancellation the grade rule
      // sees may leave rounding (1e-17) in Float64s.
      const f = (out as { fields: number[] }).fields, big = Math.max(...f.map(Math.abs));
      f.forEach((x, i) => assert.ok((m >> i) & 1 || Math.abs(x) <= 1e-12 * big, `${n}: ${JSON.stringify(out)} outside ${m.toString(2)}`));
    }
  }
});
