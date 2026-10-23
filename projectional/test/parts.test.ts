// Records of Numbers taken part by part: `map parts`, `zip parts` and
// `total` (std.ts), the constraint that types them (types.ts, "a record of
// Numbers"), and the vectors module written on them (library/vectors.json).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { relate } from "../src/lang/relate.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY, VECTORS } from "../src/lang/library.ts";
import { S } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { NUMBER, STRING, showType } from "../src/lang/types.ts";
import { verify } from "../src/lang/modules.ts";
import { buildVectors } from "../src/lang/vectors-source.ts";
import { subtree, type Id, type NodeOf } from "../src/model.ts";

const lib = (name: string) => VECTORS.exports.find((d) => VECTORS.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const num = () => k.tref(NUMBER);
  const Vec = k.type("Vec", [], [["vec", [["x", num], ["y", num], ["z", num]]]]);
  const Colour = k.type("Colour", [], [["colour", [["red", num], ["green", num], ["blue", num]]]]);
  const Named = k.type("Named", [], [["named", [["label", () => k.tref(STRING)], ["size", num]]]]);
  const vec = (...xs: number[]) => k.call(Vec.v.vec, ...xs.map((x) => k.lit(x)));
  const rgb = (...xs: number[]) => k.call(Colour.v.colour, ...xs.map((x) => k.lit(x)));
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const fn = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const defs = {
    moved: def("moved", () => k.call(lib("plus"), vec(1, 2, 3), k.call(lib("scale"), k.lit(2), vec(0.5, 0, -1)))),
    brighter: def("brighter", () => k.call(lib("clamp"), k.call(lib("scale"), k.lit(1.5), rgb(0.2, 0.6, 0.9)), k.lit(0), k.lit(1))),
    across: def("across", () => k.call(lib("dot"), vec(1, 2, 3), vec(4, 5, 6))),
    number: def("number", () => k.call(lib("mix"), k.lit(2), k.lit(4), k.lit(0.25))),
    shift: fn("shift", ["p"], (p) => k.call(lib("plus"), p, vec(1, 1, 1))),
    // Mistakes the checker catches.
    colourPlusPoint: def("colour plus point", () => k.call(lib("plus"), vec(1, 2, 3), rgb(1, 2, 3))),
    textParts: def("text parts", () => k.call(S.total, k.lit("abc"))),
    notAllNumbers: def("not all numbers", () => k.call(S.total, k.call(Named.v.named, k.lit("a"), k.lit(1)))),
    printing: fn("printing", ["c"], (c) => k.call(S.mapParts, k.fn(["x"], (x) => k.seq(k.call(S.print, k.lit("hi")), x)), c)),
  };
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), defs, Vec, Colour };
}

// The checker's messages about one definition.
const errorAt = (p: ReturnType<typeof program>, d: Id) => {
  const inside = new Set(subtree(p.code, d));
  return p.info.errors.filter((e) => inside.has(e.id)).map((e) => e.message);
};

test("the vectors module is published as built: rebuilding gives the same ids", () => {
  assert.deepEqual(buildVectors(), VECTORS);
  assert.equal(verify(VECTORS, LIBRARY.code, true), null);
  // Every definition is generic over a record of Numbers, and its pin says so.
  for (const d of VECTORS.exports) assert.deepEqual(VECTORS.pins[d].numbers, [0], VECTORS.names[d]);
});

test("one definition for points, colours and Numbers", () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const fields = (v: Value) => (v as { fields: number[] }).fields;
  assert.deepEqual(fields(r.value(p.defs.moved)), [2, 2, 1]);
  assert.deepEqual(fields(r.value(p.defs.brighter)).map((x) => +x.toFixed(9)), [0.3, 0.9, 1]);
  assert.equal(r.value(p.defs.across), 32);
  assert.equal(r.value(p.defs.number), 2.5);
});

test("adding a colour to a point, or taking the parts of text, is a type error", () => {
  const p = program();
  assert.match(errorAt(p, p.defs.colourPlusPoint).join("; "), /needs Vec here, got Colour/);
  assert.match(errorAt(p, p.defs.textParts).join("; "), /total works only on records of Numbers/);
  assert.match(errorAt(p, p.defs.notAllNumbers).join("; "), /total works only on records of Numbers/);
  // The function runs once per part, so it may not do anything else.
  assert.match(errorAt(p, p.defs.printing).join("; "), /Console/);
  for (const d of [p.defs.moved, p.defs.brighter, p.defs.across, p.defs.number, p.defs.shift]) assert.deepEqual(errorAt(p, d), [], p.names[d]);
});

test("part by part runs backwards: which point, shifted by (1, 1, 1), is (5, 0, 2)?", () => {
  const p = program();
  const lam = p.code.nodes[(p.code.nodes[p.defs.shift] as NodeOf<"def">).body!] as NodeOf<"lambda">;
  const answers = [...relate(p.code, p.defs.shift, { out: { tag: p.Vec.v.vec, fields: [5, 0, 2] } })];
  assert.equal(answers.length, 1);
  assert.deepEqual(answers[0].values[lam.params[0]], { tag: p.Vec.v.vec, fields: [4, -1, 1] });
  // And scale with the factor unknown: 3 · (1, 2, 3) is (3, 6, 9).
  const scale = lib("scale");
  const sl = p.code.nodes[(p.code.nodes[scale] as NodeOf<"def">).body!] as NodeOf<"lambda">;
  const [by] = [...relate(p.code, scale, { [sl.params[1]]: { tag: p.Vec.v.vec, fields: [1, 2, 3] }, out: { tag: p.Vec.v.vec, fields: [3, 6, 9] } })];
  assert.equal(by.values[sl.params[0]], 3);
});

// gradient: a function of a record of Numbers differentiated along each
// part (derive.ts), and derivative through records on the way.
function gradients() {
  const k = new Lang(LIBRARY.code);
  const num = () => k.tref(NUMBER);
  const Vec = k.type("Vec", [], [["vec", [["x", num], ["y", num], ["z", num]]]]);
  const vec = (...xs: Id[]) => k.call(Vec.v.vec, ...xs);
  const lits = (...xs: number[]) => vec(...xs.map((x) => k.lit(x)));
  const fn = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const square = fn("square", ["p"], (p) => k.call(lib("dot"), p, p));
  const grad = (f: Id, at: Id) => k.call(k.call(S.gradient, f), at);
  const defs = {
    // square is generic (any record of Numbers): the point says which.
    ofSquare: def("of square", () => grad(k.x(square), lits(1, 2, 3))),
    ofProduct: def("of product", () => grad(k.fn(["q"], (q) => k.call(B.mul, k.call(Vec.f["vec.x"], q), k.call(Vec.f["vec.y"], q))), lits(3, 5, 7))),
    ofDistance: def("of distance", () => grad(k.fn(["q"], (q) => k.call(lib("distance"), q, lits(1, 0, 0))), lits(1, 2, 2))),
    ofNumber: def("of a number", () => grad(k.x(square), k.lit(3))),
    // derivative through a record: |(t, 3, 4)|′ = t / |(t, 3, 4)|
    through: def("through a record", () => k.call(k.call(S.derivative, k.fn(["t"], (t) => k.call(lib("magnitude"), vec(t, k.lit(3), k.lit(4))))), k.lit(3))),
    // floor has no slope: Choice stays
    rough: fn("rough", ["p"], (p) => grad(k.fn(["q"], (q) => k.call(S.floor, k.call(Vec.f["vec.x"], q))), p)),
  };
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), defs };
}

test("gradient: a function of a point, differentiated along each part", () => {
  const g = gradients();
  const errorsIn = (d: Id) => errorAt(g as unknown as ReturnType<typeof program>, d);
  for (const d of [g.defs.ofSquare, g.defs.ofProduct, g.defs.ofDistance, g.defs.ofNumber, g.defs.through]) assert.deepEqual(errorsIn(d), [], g.names[d]);
  const typeOf = (d: Id) => showType(g.info.subst.zonk(g.info.typeOf.get((g.code.nodes[d] as NodeOf<"def">).body!)!), g.names);
  assert.match(typeOf(g.defs.rough), /-\[Choice\]->/);
  assert.doesNotMatch(typeOf(g.defs.ofProduct), /Choice/);
  const r = makeRunner(g.code, g.info, { print: () => {} });
  const fields = (v: Value) => (v as { fields: number[] }).fields.map((x) => +x.toFixed(9));
  assert.deepEqual(fields(r.value(g.defs.ofSquare)), [2, 4, 6]);
  assert.deepEqual(fields(r.value(g.defs.ofProduct)), [5, 3, 0]);
  assert.deepEqual(fields(r.value(g.defs.ofDistance)), [0, +Math.SQRT1_2.toFixed(9), +Math.SQRT1_2.toFixed(9)]);
  assert.equal(r.value(g.defs.ofNumber), 6);
  assert.equal(+(r.value(g.defs.through) as number).toFixed(9), +(3 / Math.sqrt(34)).toFixed(9));
});
