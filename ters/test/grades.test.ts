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
import { algebrasOf, bladeMask, describeMask, gradeMistakes } from "../src/lang/grades.ts";
import { ARITH, CONS, LIST, NIL } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import { SET } from "../src/lang/std.ts";
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
  return { k, M, def, at, call, done: () => { const code = base(k.code), names = { ...baseNames(), ...k.names }; return { code, names, info: infer(code, names) }; } };
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

test("a part read outside a value's mask is a wrong grade (L43e)", () => {
  const a = algebra([1, 1, 1]);
  const { k, def, at, call } = a;
  const vec = (x: Id) => at({ 1: x, 2: x, 4: x });
  const part = (v: Id, ...b: number[]) => call("part", v, k.list(...b.map((x) => k.lit(x))));
  const fns = {
    // e₁₂ of a vector: always 0.
    wrong: def("bivector of a vector", () => k.fn(["x"], (x) => part(vec(x), 1, 2))),
    // e₁ of a vector, e₁₂ of a product of two: both fine.
    right: def("fine", () => k.fn(["x"], (x) => k.call(ARITH.add, part(vec(x), 1), part(call("product", vec(x), vec(x)), 2, 1)))),
    // An input is every part, so reading any of its blades is fine.
    input: def("any input", () => k.fn(["v"], (v) => part(v, 1, 2, 3))),
    // Through a call: the helper reads e₃ of what it is given, a bivector here.
    helper: def("third", () => k.fn(["v"], (v) => part(v, 3))),
  };
  const caller = def("third of a bivector", () => k.fn(["x"], (x) => k.call(k.x(fns.helper), call("outer", vec(x), vec(x)))));
  const { code, info } = a.done();
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const found = gradeMistakes(code, info, [...Object.values(fns), caller]);
  assert.deepEqual(found.map((f) => [f.def, f.message]), [
    [fns.wrong, "reads the e₁₂ part of a value that is a vector, so it is always 0"],
    [caller, "reads the e₃ part of a value that is a bivector, so it is always 0"],
  ]);
});

test("a field named Vector of T holds only vectors: each blade combination its own type (L43e)", () => {
  const a = algebra([1, 1, 1]);
  const { k, M, def, at, call } = a;
  const vec = (x: Id) => at({ 1: x, 2: x, 4: x });
  // A body: where it is, a vector, and how it is turned, a rotor.
  const Body = k.type("Body", [], [["body", [
    ["at", () => k.tref("type.vector of", k.tref(M.def))],
    ["turn", () => k.tref("type.rotor of", k.tref(M.def))],
  ]]]);
  const atF = Body.f["body.at"], turnF = Body.f["body.turn"];
  const part = (v: Id, ...b: number[]) => call("part", v, k.list(...b.map((x) => k.lit(x))));
  const fns = {
    right: def("a body", () => k.fn(["x"], (x) => k.call(Body.v.body, vec(x), call("exp", at({ 3: x }))))),
    // A rotor where the vector goes, and a vector where the rotor goes.
    swapped: def("swapped", () => k.fn(["x"], (x) => k.call(Body.v.body, call("exp", at({ 3: x })), vec(x)))),
    // A product of two vectors put back with set: scalar and bivector.
    set: def("set wrong", () => k.fn(["b"], (b) => k.call(SET, k.x(atF), b, call("product", k.call(atF, b), k.call(atF, b))))),
    moved: def("moved", () => k.fn(["b", "x"], (b, x) => k.call(SET, k.x(atF), b, k.call(ARITH.add, k.call(atF, b), vec(x))))),
    // Read from the field, it is a vector: its e₁₂ is always 0.
    read: def("bivector of where", () => k.fn(["b"], (b) => part(k.call(atF, b), 1, 2))),
    // Inputs aren't known, so they are checked where the call gives them.
    make: def("make", () => k.fn(["p", "r"], (p, r) => k.call(Body.v.body, p, r))),
  };
  const caller = def("make wrong", () => k.fn(["x"], (x) => k.call(k.x(fns.make), call("outer", vec(x), vec(x)), call("exp", at({ 3: x })))));
  const { code, info } = a.done();
  // To the type checker a Vector of Multivector is a Multivector.
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const found = gradeMistakes(code, info, [...Object.values(fns), caller]);
  assert.deepEqual(found.map((f) => [f.def, f.message]), [
    [fns.swapped, "puts a value that is 1, e₁₂ where Vector of goes, a vector"],
    [fns.swapped, "puts a value that is a vector where Rotor of goes, even (a rotor or motor)"],
    [fns.set, "puts a value that is even (a rotor or motor) where Vector of goes, a vector"],
    [fns.read, "reads the e₁₂ part of a value that is a vector, so it is always 0"],
    [caller, "puts a value that is a bivector where Vector of goes, a vector"],
  ]);
  // What a definition gives from the field is a vector.
  const where = def("where", () => k.fn(["b"], (b) => k.call(atF, b)));
  const p2 = a.done();
  const r = bladeMask(p2.code, p2.info, where)!;
  assert.equal(describeMask(r.algebra, r.mask), "a vector");
  void turnF;
});

test("a field named List (Vector of T) holds only vectors, item by item (L43e3)", () => {
  const a = algebra([1, 1, 1]);
  const { k, M, def, at, call } = a;
  const vec = (x: Id) => at({ 1: x, 2: x, 4: x });
  const Trail = k.type("Trail", [], [["trail", [["points", () => k.tref(LIST, k.tref("type.vector of", k.tref(M.def)))]]]]);
  const pointsF = Trail.f["trail.points"];
  const part = (v: Id, ...b: number[]) => call("part", v, k.list(...b.map((x) => k.lit(x))));
  let wrongItem = "", setItem = "";
  const fns = {
    right: def("a trail", () => k.fn(["x"], (x) => k.call(Trail.v.trail, k.list(vec(x), vec(x))))),
    wrong: def("a rotor in it", () => k.fn(["x"], (x) => k.call(Trail.v.trail, k.list(vec(x), (wrongItem = call("exp", at({ 3: x }))))))),
    added: def("added", () => k.fn(["t", "x"], (t, x) => k.call(SET, k.x(pointsF), t, k.call(CONS, (setItem = call("product", vec(x), vec(x))), k.call(pointsF, t))))),
    // An item read from the field is a vector: its e₁₂ is always 0.
    read: def("bivector of the first", () => k.fn(["t"], (t) => k.match(k.call(pointsF, t), [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["p", "rest"], body: ([p]) => part(p, 1, 2) },
    ]))),
  };
  const { code, info } = a.done();
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const found = gradeMistakes(code, info, Object.values(fns));
  assert.deepEqual(found.map((f) => [f.def, f.message]).sort(), [
    [fns.added, "puts an item that is even (a rotor or motor) where a list of Vector of goes, a vector each"],
    [fns.wrong, "puts an item that is 1, e₁₂ where a list of Vector of goes, a vector each"],
    [fns.read, "reads the e₁₂ part of a value that is a vector, so it is always 0"],
  ].sort());
  assert.ok(wrongItem && setItem);
});

test("the mask tables worked out from the blades are what running each operation gives (L43c)", () => {
  // Euclidean, Lorentzian and degenerate (2D PGA, where e₀ squares to 0).
  for (const squares of [[1, 1, 1], [1, -1, -1], [0, 1, 1], [-1, 0]]) {
    const a = algebra(squares);
    const { code, info } = a.done();
    assert.deepEqual(info.errors.map((e) => e.message), []);
    const alg = [...algebrasOf(code, info).values()][0];
    const r = makeRunner(code, info, { print: () => {} });
    const al = r.value(alg.def);
    const basis = [...Array(alg.parts).keys()].map((i) => {
      const fields = Array.from({ length: alg.parts }, (_, j) => (j === i ? 1 : 0));
      return { tag: alg.variant, fields } as unknown as Value;
    });
    const maskOf = (v: Value) => (v as unknown as { fields: number[] }).fields.reduce((m, x, i) => (x !== 0 ? m | (1 << i) : m), 0);
    const libDef = (name: string) => Object.keys(LIBRARY.names).find((id) => LIBRARY.names[id] === name && LIBRARY.code.nodes[id]?.kind === "def")!;
    const run = (op: string, ...xs: Value[]) => maskOf(first(r.call(r.value(libDef(`clifford ${op}`)), al, ...xs) as Iterable<Value>)!);
    for (let i = 0; i < alg.parts; i++) {
      for (const op of ["reverse", "involute", "dual", "undual"] as const) assert.equal(alg.one(op, i), run(op, basis[i]), `${squares} ${op} ${i}`);
      for (let j = 0; j < alg.parts; j++)
        for (const op of ["product", "outer", "inner", "regressive"] as const) assert.equal(alg.pair(op, i, j), run(op, basis[i], basis[j]), `${squares} ${op} ${i} ${j}`);
    }
  }
});
