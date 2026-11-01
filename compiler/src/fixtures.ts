// Small programs written for the tests and the benchmark, in the DSL.

import { STOPS } from "./stops.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { B } from "../../ters/src/prelude.ts";
import { ABORT_OP, ARITH, ARRAY_OPS, COMPARE, CONS, FALSE, INT_OPS, IO, NIL, NONE, PAIR_V, S, SECOND, SOME, TEXT_OPS, TRUE } from "../../ters/src/lang/std.ts";
// S as the pga fixture names it is its Space type.
const STD = S;
import { INT, NUMBER, STRING } from "../../ters/src/lang/types.ts";
import type { Id } from "../../ters/src/model.ts";
import { LIBRARY, VECTORS } from "../../ters/src/lang/library.ts";

// The area under x·x·x − x − 1 from `from`, in `steps` strips of width
// `width`: a numeric loop written as tail recursion, the way the language
// writes loops. Nothing gets smaller, so its type carries Diverge, and the
// GPU and WASM take it only under a budget: `integral` allows two million
// calls, `capped` only ten, so it runs out for more than nine strips and
// gives -1.
export function area() {
  const k = new Lang();
  const f = k.def("f");
  k.define(f, k.fn(["x"], (x) => k.call(B.sub, k.call(B.sub, k.call(B.mul, k.call(B.mul, x, x), x), x), k.lit(1))));
  const area = k.def("area");
  k.define(area, k.fn(["x", "width", "steps", "total"], (x, w, n, acc) =>
    k.if(k.call(S.less, n, k.lit(1)), acc,
      k.call(area, k.call(B.add, x, w), w, k.call(B.sub, n, k.lit(1)), k.call(B.add, acc, k.call(B.mul, k.call(f, x), w))))));
  const budget = (name: string, fuel: number) => {
    const d = k.def(name);
    k.define(d, k.fn(["x", "width", "steps"], (x, w, n) => within(k, fuel, () => k.call(area, x, w, n, k.lit(0)), () => k.lit(-1))));
    return d;
  };
  const integral = budget("integral", 2_000_000), capped = budget("capped", 10);
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), area, f, integral, capped };
}

// first(() => with fuel(n, () => body), () => otherwise): the budget the
// scalar profile takes something that might not finish under.
export function within(k: Lang, n: number, body: () => Id, otherwise: () => Id): Id {
  return k.call(S.first, k.thunk(() => k.call(S.fuel, k.lit(n), k.thunk(body))), k.thunk(otherwise));
}

// The corners of the shader printer (wgsl.ts): an `if` in the middle of an
// expression, a let, Bool inputs and results, `pow` of a negative base,
// and two kinds of recursion a GPU can't run (calling itself not as the
// last step, and two definitions calling each other), next to one that
// is a loop (Euclid's gcd by subtraction).
export function corners() {
  const k = new Lang();
  const n = (v: number) => k.lit(v);
  const clampish = k.def("clampish");
  k.define(clampish, k.fn(["x"], (x) => k.call(B.add, k.lit(1), k.if(k.call(S.less, x, n(0)), n(0), k.let("y", k.call(B.mul, x, x), (y) => k.call(B.sub, y, x))))));
  const pick = k.def("pick");
  k.define(pick, k.fn(["b", "x"], (b, x) => k.if(k.call(S.and, b, k.call(S.less, n(0), x)), k.call(B.sqrt, x), k.call(B.neg, x))));
  const near = k.def("near");
  k.define(near, k.fn(["x", "y"], (x, y) => k.call(S.or, k.equal(x, y), k.call(S.less, k.call(S.abs, k.call(B.sub, x, y)), n(0.5)))));
  const cube = k.def("cube");
  k.define(cube, k.fn(["x"], (x) => k.call(B.add, k.call(B.pow, x, n(3)), k.call(B.pow, k.call(B.sub, x, n(2)), n(3)))));
  const powers = k.def("powers");
  k.define(powers, k.fn(["x", "y"], (x, y) => k.call(B.pow, x, k.call(S.floor, y))));
  const gcd = k.def("gcd");
  k.define(gcd, k.fn(["a", "b"], (a, b) => k.if(k.equal(a, b), a, k.if(k.call(S.less, a, b), k.call(gcd, a, k.call(B.sub, b, a)), k.call(gcd, k.call(B.sub, a, b), b)))));
  const fact = k.def("fact");
  k.define(fact, k.fn(["n"], (m) => k.if(k.call(S.less, m, n(1)), n(1), k.call(B.mul, m, k.call(fact, k.call(B.sub, m, n(1)))))));
  const even = k.def("even"), odd = k.def("odd");
  k.define(even, k.fn(["n"], (m) => k.if(k.call(S.less, m, n(1)), k.equal(m, n(0)), k.call(odd, k.call(B.sub, m, n(1))))));
  k.define(odd, k.fn(["n"], (m) => k.if(k.call(S.less, m, n(1)), k.equal(m, n(1)), k.call(even, k.call(B.sub, m, n(1))))));
  const twice = k.def("fact twice");
  k.define(twice, k.fn(["n"], (m) => k.call(B.add, k.call(fact, m), k.call(fact, m))));
  // The same, under budgets: allowed to start, so what's left is whether a
  // GPU can run them.
  const fuelled = (name: string, body: (m: Id) => Id) => { const w = k.def(name); k.define(w, k.fn(["n"], (m) => within(k, 1000, () => body(m), () => k.lit(0)))); return w; };
  const gcdOf = k.def("gcd of");
  k.define(gcdOf, k.fn(["a", "b"], (a, b) => within(k, 1000, () => k.call(gcd, a, b), () => k.lit(0))));
  const factOf = fuelled("fact of", (m) => k.call(fact, m)), isEven = fuelled("is even", (m) => k.if(k.call(even, m), k.at(NUMBER, 1), k.at(NUMBER, -1)));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs: { clampish, pick, near, cube, powers, gcd, fact, even, odd, twice, gcdOf, factOf, isEven } };
}

// Records in the shader profile: a 3D vector, a ray made of two of them,
// the standard library's Pair, a match that takes a record apart, and a
// loop (tail recursion) whose state is a record. And two types that
// aren't records of numbers: a list (recursive) and Optional (two cases).
export function vectors() {
  const k = new Lang();
  const n = (v: number) => k.lit(v);
  const num = () => k.tref(NUMBER);
  const Vec = k.type("Vec", [], [["vec", [["x", num], ["y", num], ["z", num]]]]);
  const vec = Vec.v.vec, X = Vec.f["vec.x"], Y = Vec.f["vec.y"], Z = Vec.f["vec.z"];
  const Ray = k.type("Ray", [], [["ray", [["origin", () => k.tref(Vec.def)], ["direction", () => k.tref(Vec.def)]]]]);
  const along = k.def("along");
  // origin + t · direction
  k.define(along, k.fn(["ray", "t"], (r, t) => k.match(r, [{ variant: Ray.v.ray, names: ["o", "d"], body: ([o, d]) =>
    k.call(vec, k.call(B.add, k.call(X, o), k.call(B.mul, t, k.call(X, d))), k.call(B.add, k.call(Y, o), k.call(B.mul, t, k.call(Y, d))), k.call(B.add, k.call(Z, o), k.call(B.mul, t, k.call(Z, d)))) }])));
  const length = k.def("length");
  k.define(length, k.fn(["v"], (v) => k.call(B.sqrt, k.call(B.add, k.call(B.add, k.call(B.mul, k.call(X, v), k.call(X, v)), k.call(B.mul, k.call(Y, v), k.call(Y, v))), k.call(B.mul, k.call(Z, v), k.call(Z, v))))));
  // v over its length, field by field: normalize(v) on a GPU.
  const unit = k.def("unit");
  k.define(unit, k.fn(["v"], (v) => k.call(vec, k.call(B.div, k.call(X, v), k.call(length, v)), k.call(B.div, k.call(Y, v), k.call(length, v)), k.call(B.div, k.call(Z, v), k.call(length, v)))));
  // The same Float64 in every part: vec3f(x).
  const diagonal = k.def("diagonal");
  k.define(diagonal, k.fn(["x"], (x) => k.call(vec, x, x, x)));
  const farther = k.def("farther");
  k.define(farther, k.fn(["a", "b"], (a, b) => k.if(k.call(S.less, k.call(length, a), k.call(length, b)), b, a)));
  // Walk along the ray until 4 away from the start: a loop whose state is a Vec.
  const walk = k.def("walk");
  k.define(walk, k.fn(["p", "step", "n"], (p, step, m) => k.if(k.call(S.less, n(4), k.call(length, p)), k.call(PAIR_V, k.call(length, p), m),
    k.call(walk, k.call(vec, k.call(B.add, k.call(X, p), step), k.call(Y, p), k.call(B.add, k.call(Z, p), k.call(B.mul, n(0.5), step))), step, k.call(B.add, m, n(1))))));
  const shoot = k.def("shoot");
  k.define(shoot, k.fn(["x", "y", "t"], (x, y, t) => k.call(along, k.call(Ray.v.ray, k.call(vec, x, y, n(-2)), k.call(vec, k.call(B.neg, x), n(0.5), n(1))), t)));
  const steps = k.def("steps");
  k.define(steps, k.fn(["x", "step"], (x, step) => k.call(SECOND, within(k, 1000, () => k.call(walk, k.call(vec, x, n(1), n(0)), step, n(0)), () => k.call(PAIR_V, n(0), n(-1))))));
  const sum = k.def("sum");
  k.define(sum, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => n(0) },
    { variant: CONS, names: ["x", "rest"], results: [null, "s"], body: ([x], [, s]) => k.call(B.add, x, s!) },
  ])));
  const orZero = k.def("or zero");
  k.define(orZero, k.fn(["o"], (o) => k.match(o, [{ variant: SOME, names: ["x"], body: ([x]) => x }, { variant: NONE, names: [], body: () => n(0) }])));
  // An input never looked at can be anything; the profile takes it at
  // whatever each call passes (a Float64, a Vec).
  const twice = k.def("twice ignoring");
  k.define(twice, k.fn(["x", "ignored"], (x) => k.call(B.mul, n(2), x)));
  const numbers = k.def("twice a number");
  k.define(numbers, k.fn(["x"], (x) => k.call(twice, x, x)));
  const vecs = k.def("twice a vec");
  k.define(vecs, k.fn(["x"], (x) => k.call(twice, x, k.call(vec, x, x, x))));
  // Linear maps (MATRICES.md layer 1): a shear, a turn about z by 30°
  // that names cos and sin, the turn after the shear, and a move.
  const shear = k.def("shear");
  k.define(shear, k.fn(["v"], (v) => k.call(vec, k.call(B.add, k.call(X, v), k.call(B.mul, n(0.5), k.call(Y, v))), k.call(Y, v), k.call(Z, v))));
  const turn = k.def("turn");
  k.define(turn, k.fn(["v"], (v) => k.match(v, [{ variant: vec, names: ["x", "y", "z"], body: ([x, y, z]) =>
    k.let("c", k.call(B.cos, k.call(B.div, n(Math.PI), n(6))), (c) => k.let("s", k.call(B.sin, k.call(B.div, n(Math.PI), n(6))), (s) =>
      k.call(vec, k.call(B.sub, k.call(B.mul, c, x), k.call(B.mul, s, y)), k.call(B.add, k.call(B.mul, s, x), k.call(B.mul, c, y)), z))) }])));
  const sheared = k.def("turned shear");
  k.define(sheared, k.fn(["x", "y", "z"], (x, y, z) => k.call(turn, k.call(shear, k.call(vec, x, y, z)))));
  const lifted = k.def("lifted shear");
  k.define(lifted, k.fn(["v"], (v) => k.call(vec, k.call(B.add, k.call(X, v), k.call(Z, v)), k.call(Y, v), k.call(B.add, k.call(Z, v), n(2)))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs: { along, length, unit, diagonal, farther, walk, shoot, steps, sum, orZero, twice, numbers, vecs, shear, turn, sheared, lifted } };
}

// The vectors module (ters/src/lang/vectors-source.ts) on a
// program's own point and colour types, and on plain Float64s: each module
// definition is written once, for every record of Float64s.
export function parts() {
  const k = new Lang(LIBRARY.code);
  const num = () => k.tref(NUMBER);
  const Vec = k.type("Vec", [], [["vec", [["x", num], ["y", num], ["z", num]]]]);
  const Colour = k.type("Colour", [], [["colour", [["red", num], ["green", num], ["blue", num]]]]);
  const lib = (name: string) => VECTORS.exports.find((d) => VECTORS.names[d] === name)!;
  const vec = (x: Id, y: Id, z: Id) => k.call(Vec.v.vec, x, y, z);
  const rgb = (r: Id, g: Id, b: Id) => k.call(Colour.v.colour, r, g, b);
  const def = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const defs = {
    // Points and directions.
    along: def("along", ["ox", "oy", "oz", "t"], (ox, oy, oz, t) => k.call(lib("plus"), vec(ox, oy, oz), k.call(lib("scale"), t, vec(k.lit(0.3), k.lit(-0.5), k.lit(1))))),
    facing: def("facing", ["x", "y", "z"], (x, y, z) => k.call(lib("dot"), k.call(lib("unit"), vec(x, y, z)), vec(k.lit(0), k.lit(1), k.lit(0)))),
    far: def("far", ["x", "y", "z"], (x, y, z) => k.call(lib("distance"), vec(x, y, z), vec(k.lit(1), k.lit(2), k.lit(3)))),
    bounce: def("bounce", ["x", "y", "z"], (x, y, z) => k.call(lib("reflect"), vec(x, y, z), k.call(lib("unit"), vec(k.lit(0.2), k.lit(1), k.lit(0))))),
    // Colours.
    fade: def("fade", ["r", "g", "b", "t"], (r, g, b, t) => k.call(lib("mix"), rgb(r, g, b), rgb(k.lit(0.55), k.lit(0.68), k.lit(0.85)), t)),
    light: def("light", ["r", "g", "b", "by"], (r, g, b, by) => k.call(lib("clamp"), k.call(lib("times"), k.call(lib("scale"), by, rgb(r, g, b)), rgb(k.lit(1), k.lit(0.9), k.lit(0.8))), k.lit(0), k.lit(1))),
    // A Float64 is a record of one part.
    halfway: def("halfway", ["a"], (a) => k.call(lib("mix"), a, k.lit(10), k.lit(0.5))),
    size: def("size", ["x"], (x) => k.call(lib("magnitude"), k.call(B.neg, x))),
  };
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs, Vec, Colour };
}

// Structural equal on lists of Float64s: `same` compares two lists with
// one more number in front of each (which makes them lists of Float64s),
// by the evaluator's rule for each number.
export function sameLists() {
  const k = new Lang();
  const same = k.def("same");
  k.define(same, k.fn(["xs", "ys"], (xs, ys) => k.equal(k.call(CONS, k.at(NUMBER, 0), xs), k.call(CONS, k.at(NUMBER, 0), ys))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), same };
}

// Functions as values: `twice` calls the function it's given twice,
// `shifted` gives it a function that captured d, `squared twice` a
// definition by name, and `ten` is a constant.
export function closures() {
  const k = new Lang();
  const twice = k.def("twice"), square = k.def("square"), shifted = k.def("shifted"), squaredTwice = k.def("squared twice"), ten = k.def("ten");
  k.define(twice, k.fn(["f", "x"], (f, x) => k.call(f, k.call(f, x))));
  k.define(square, k.fn(["x"], (x) => k.call(B.mul, x, x)));
  k.define(ten, k.at(NUMBER, 10));
  k.define(shifted, k.fn(["d", "x"], (d, x) => k.call(twice, k.fn(["y"], (y) => k.call(B.add, k.call(B.mul, y, d), ten)), x)));
  k.define(squaredTwice, k.fn(["x"], (x) => k.call(twice, square, x)));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), shifted, squaredTwice };
}

// Text and Int: each text builtin once, so WebAssembly's runtime
// (wasm-rt.ts) can be compared with the evaluator on any input.
export function texts() {
  const k = new Lang();
  const d = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const x = k.def(name); k.define(x, k.fn(params, body)); return x; };
  const defs = {
    sliced: d("sliced", ["t", "a", "b"], (t, a, b) => k.call(TEXT_OPS.slice, t, a, b)),
    length: d("length of", ["t"], (t) => k.call(TEXT_OPS.length, t)),
    pieces: d("pieces", ["t", "by"], (t, by) => k.call(TEXT_OPS.joinAll, k.call(TEXT_OPS.split, t, by), k.lit("|"))),
    chars: d("chars", ["t"], (t) => k.call(TEXT_OPS.joinAll, k.call(TEXT_OPS.characters, t), k.lit(","))),
    before: d("before", ["a", "b"], (a, b) => k.call(TEXT_OPS.less, a, b)),
    same: d("same", ["a", "b"], (a, b) => k.equal(k.call(S.concat, a, k.lit("")), b)),
    glued: d("glued", ["a", "b"], (a, b) => k.call(S.concat, a, k.call(S.concat, k.lit("·"), b))),
    shown: d("shown", ["x"], (x) => k.call(S.show, k.call(B.add, x, k.lit(0)))),
    arith: d("arith", ["a", "b"], (a, b) => k.call(INT_OPS.show, k.call(INT_OPS.add, k.call(INT_OPS.sub, k.call(INT_OPS.mul, a, b), a), k.call(INT_OPS.neg, k.call(INT_OPS.abs, b))))),
    smaller: d("smaller", ["a", "b"], (a, b) => k.if(k.call(INT_OPS.less, a, b), k.call(INT_OPS.toNumber, a), k.call(INT_OPS.toNumber, b))),
    sameInt: d("sameInt", ["a", "b"], (a, b) => k.equal(k.call(INT_OPS.abs, a), b)),
    remainder: d("remainder", ["a", "b"], (a, b) => k.call(S.mod, k.call(B.add, a, k.lit(0)), b)),
  };
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs };
}

// Searches with one answer or none: each Choice builtin under a handler,
// a partial function of the program's own (index, a tail call to
// itself), a fold whose arm may have none (sum), handlers inside handlers,
// a definition that has Choice itself (plus one), and budgets around
// searches, so WebAssembly's found-flag returns can be compared with the
// evaluator on any input.
export function choices() {
  const k = new Lang();
  const d = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const x = k.def(name); k.define(x, k.fn(params, body)); return x; };
  const opt = (body: () => Id) => k.call(S.optional, k.thunk(body));
  const index = k.def("index");
  k.define(index, k.fn(["key", "xs", "i"], (key, xs, i) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.if(k.equal(x, k.call(S.concat, key, k.lit(""))), i, k.call(index, key, rest, k.call(INT_OPS.add, i, k.int(1)))) },
  ])));
  const sum = k.def("sum");
  k.define(sum, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.int(0) },
    { variant: CONS, names: ["x", "rest"], results: [null, "r"], body: ([x], [, r]) => k.call(INT_OPS.add, k.call(INT_OPS.read, x), r!) },
  ])));
  const down = k.def("down");
  k.define(down, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(0)), k.call(S.fail), k.if(k.equal(n, k.lit(0)), k.lit(0), k.call(down, k.call(B.sub, n, k.lit(1)))))));
  const defs = {
    quotient: d("quotient of", ["a", "b"], (a, b) => opt(() => k.call(INT_OPS.quotient, a, b))),
    remainder: d("remainder of", ["a", "b"], (a, b) => opt(() => k.call(INT_OPS.remainder, a, b))),
    power: d("power of", ["a", "b"], (a, b) => opt(() => k.call(INT_OPS.power, a, b))),
    whole: d("whole", ["x"], (x) => opt(() => k.call(INT_OPS.wholePart, x))),
    reread: d("reread", ["t"], (t) => k.call(S.first, k.thunk(() => k.call(INT_OPS.show, k.call(INT_OPS.read, t))), k.thunk(() => k.lit("no")))),
    found: d("found", ["t", "p"], (t, p) => opt(() => k.call(TEXT_OPS.find, t, p))),
    code: d("code of", ["t"], (t) => opt(() => k.call(TEXT_OPS.code, t))),
    character: d("character of", ["n"], (n) => k.call(S.first, k.thunk(() => k.call(TEXT_OPS.fromCode, n)), k.thunk(() => k.lit("?")))),
    position: d("position", ["key", "xs"], (key, xs) => opt(() => k.call(index, key, xs, k.int(0)))),
    sums: d("sums", ["xs"], (xs) => k.call(S.all, k.thunk(() => k.call(sum, xs)))),
    readable: d("readable", ["t"], (t) => k.call(S.count, k.thunk(() => k.call(INT_OPS.read, t)))),
    unwrapped: d("unwrapped", ["t"], (t) => k.call(S.first, k.thunk(() => k.call(S.valueOf, opt(() => k.call(INT_OPS.read, t)))), k.thunk(() => k.int(-1)))),
    plusOne: d("plus one", ["t"], (t) => k.call(INT_OPS.add, k.call(INT_OPS.read, t), k.int(1))),
    budgeted: d("budgeted", ["n"], (n) => within(k, 5, () => k.call(down, n), () => k.lit(-1))),
    inside: d("inside", ["n"], (n) => within(k, 5, () => k.call(S.first, k.thunk(() => k.call(down, n)), k.thunk(() => k.lit(-5))), () => k.lit(-1))),
  };
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs };
}

// Searches that choose one of a list, inside first, optional, all and
// count: one choice (keep's shape), two nested, a let between them that
// may have no answer, and functions with Choice as values (map with read,
// a partial function passed in and called in tail position).
export function searches() {
  const k = new Lang(LIBRARY.code);
  const lib = (name: string) => LIBRARY.code.defs.find((x) => LIBRARY.names[x] === name)!;
  const d = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const x = k.def(name); k.define(x, k.fn(params, body)); return x; };
  const txt = (x: Id) => k.call(S.concat, x, k.lit(""));
  const choose = (xs: Id, body: (x: Id) => Id) => k.let("x", k.call(S.oneOf, xs), body);
  const pair = (xs: Id, ys: Id) => k.let("x", k.call(S.oneOf, xs), (x) => k.let("y", k.call(S.oneOf, ys), (y) =>
    k.if(k.call(TEXT_OPS.less, txt(x), txt(y)), k.call(S.concat, x, y), k.call(S.fail))));
  const apply = k.def("apply");
  k.define(apply, k.fn(["f", "t"], (f, t) => k.call(f, t)));
  const down = k.def("down");
  k.define(down, k.fn(["n"], (n) => k.if(k.equal(n, k.lit(0)), k.lit(0), k.call(down, k.call(B.sub, n, k.lit(1))))));
  const defs = {
    kept: d("kept", ["xs"], (xs) => k.call(lib("keep"), xs, k.fn(["t"], (t) => k.call(INT_OPS.less, k.int(2), k.call(INT_OPS.read, t))))),
    pairs: d("pairs", ["xs", "ys"], (xs, ys) => k.call(S.all, k.thunk(() => pair(xs, ys)))),
    many: d("how many", ["xs", "ys"], (xs, ys) => k.call(S.count, k.thunk(() => pair(xs, ys)))),
    firstPair: d("first pair", ["xs", "ys"], (xs, ys) => k.call(S.first, k.thunk(() => pair(xs, ys)), k.thunk(() => k.lit("none")))),
    some: d("some pair", ["xs", "ys"], (xs, ys) => k.call(S.optional, k.thunk(() => pair(xs, ys)))),
    // A let that may have no answer between the choice and the test.
    read: d("read ones", ["xs"], (xs) => k.call(S.all, k.thunk(() => choose(xs, (x) => k.let("n", k.call(INT_OPS.read, txt(x)), (n) => k.call(INT_OPS.add, n, k.int(1))))))),
    readCount: d("count read", ["xs"], (xs) => k.call(S.count, k.thunk(() => choose(xs, (x) => k.call(INT_OPS.read, txt(x)))))),
    mapped: d("mapped", ["xs"], (xs) => k.call(S.optional, k.thunk(() => k.call(lib("map"), xs, k.fn(["t"], (t) => k.call(INT_OPS.read, txt(t))))))),
    applied: d("applied", ["t"], (t) => k.call(S.first, k.thunk(() => k.call(apply, k.fn(["s"], (s) => k.call(INT_OPS.show, k.call(INT_OPS.read, s))), t)), k.thunk(() => k.lit("no")))),
    // An abort goes on through first and a budget to its handler; an
    // unhandled one is the function's.
    caught: d("caught", ["t"], (t) => k.match(k.call(S.first, k.thunk(() => k.if(k.equal(txt(t), k.lit("x")), k.call(ABORT_OP, k.lit("an x")), k.call(INT_OPS.show, k.call(INT_OPS.read, t)))), k.thunk(() => k.lit("none"))),
      [{ variant: ABORT_OP, names: ["reason"], body: ([r]) => k.call(S.concat, k.lit("caught: "), r) }])),
    budgetAbort: d("budget abort", ["n"], (n) => k.match(within(k, 5, () => k.if(k.call(S.less, n, k.lit(0)), k.call(ABORT_OP, k.lit("negative")), k.call(down, n)), () => k.lit(-1)),
      [{ variant: ABORT_OP, names: ["reason"], body: () => k.lit(-2) }])),
    uncaught: d("uncaught", ["t"], (t) => k.if(k.equal(txt(t), k.lit("")), k.call(ABORT_OP, k.lit("nothing to read")), k.call(INT_OPS.add, k.call(INT_OPS.read, t), k.int(0)))),
  };
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs };
}

// A program using every operation on the console and files that wc,
// ledger, chapters and calc don't: it lists its folder, asks whether
// files exist, copies its input's lines to a file a line at a time, and
// lists each folder it's given (aborting on one that isn't).
export function worldly() {
  const k = new Lang();
  const d = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const x = k.def(name); k.define(x, k.fn(params, body)); return x; };
  const each = k.def("each");
  k.define(each, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.int(0) },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.seq(k.call(S.print, x), k.call(each, rest)) },
  ])));
  const echo = k.def("echo");
  k.define(echo, k.fn(["n"], (n) => k.match(k.call(IO.readLine), [
    { variant: NONE, names: [], body: () => n },
    { variant: SOME, names: ["line"], body: ([l]) => k.seq(k.call(IO.appendFile, k.lit("lines.txt"), k.call(S.concat, l, k.lit("\n"))), k.call(echo, k.call(INT_OPS.add, n, k.int(1)))) },
  ])));
  const go = k.def("go");
  k.define(go, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.int(0) },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.seq(k.call(each, k.call(IO.listFolder, x)), k.call(go, rest)) },
  ])));
  const exists = (path: string) => k.call(S.print, k.if(k.call(IO.fileExists, k.lit(path)), k.lit(`${path}: yes`), k.lit(`${path}: no`)));
  const main = d("main", ["args"], (args) => k.seq(
    k.call(each, k.call(IO.listFolder, k.lit("."))), exists("a.txt"), exists("nope"), exists("out"),
    k.call(IO.writeFile, k.lit("w.txt"), k.lit("written")), k.call(IO.printError, k.call(IO.readFile, k.lit("w.txt"))),
    k.call(S.print, k.call(INT_OPS.show, k.call(echo, k.int(0)))),
    k.call(go, args), k.int(3)));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), main };
}

// Searches with several answers inside called functions (W4d): a choice
// in a function, in arguments (left to right), in a fold that chooses on
// the way back up (subset sums), under each handler, with an abort
// among the answers.
export function several() {
  const k = new Lang();
  const n = (v: number) => k.lit(v);
  const d = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const x = k.def(name); k.define(x, k.fn(params, body)); return x; };
  const pick = d("pick", ["xs"], (xs) => k.call(S.oneOf, xs));
  const pairUp = d("pair up", ["xs", "ys"], (xs, ys) => k.call(CONS, k.call(B.add, k.call(pick, xs), n(0)), k.call(CONS, k.call(pick, ys), NIL)));
  const sums = d("sums", ["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => n(0) },
    { variant: CONS, names: ["x", "rest"], results: [null, "s"], body: ([x], [, s]) => k.match(k.call(S.oneOf, k.list(TRUE, FALSE)), [
      { variant: TRUE, names: [], body: () => k.call(B.add, x, s!) },
      { variant: FALSE, names: [], body: () => s! },
    ]) },
  ]));
  const checked = d("checked", ["xs"], (xs) => k.let("x", k.call(pick, xs), (x) => k.if(k.call(S.less, x, n(0)), k.call(ABORT_OP, k.lit("negative")), x)));
  const defs = {
    firstBig: d("first big", ["xs", "n"], (xs, m) => k.call(S.first, k.thunk(() => k.let("s", k.call(sums, xs), (s) => k.if(k.call(S.less, m, s), s, k.call(S.fail)))), k.thunk(() => n(-1)))),
    allSums: d("all sums", ["xs"], (xs) => k.call(S.all, k.thunk(() => k.call(sums, xs)))),
    pairs: d("all pairs", ["xs", "ys"], (xs, ys) => k.call(S.all, k.thunk(() => k.call(pairUp, xs, ys)))),
    howMany: d("how many", ["xs"], (xs) => k.call(S.count, k.thunk(() => k.call(pairUp, xs, xs)))),
    some: d("some over", ["xs", "n"], (xs, m) => k.call(S.optional, k.thunk(() => k.let("x", k.call(pick, xs), (x) => k.if(k.call(S.less, m, x), k.call(B.mul, x, n(10)), k.call(S.fail)))))),
    checked: d("all checked", ["xs"], (xs) => k.call(S.all, k.thunk(() => k.call(checked, xs)))),
    caught: d("caught", ["xs"], (xs) => k.match(k.call(S.count, k.thunk(() => k.call(checked, xs))), [{ variant: ABORT_OP, names: ["why"], body: () => n(-1) }])),
  };
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs };
}

// Folds over nested data: a rose tree, whose children are a List of
// trees, and a grove, whose rows are a List of Lists of them. A child
// field's folded value is the container with each tree folded (List R).
export function roses() {
  const k = new Lang();
  const rose = k.type("rose", [], [["node", [["value", () => k.tref("type.number")], ["kids", (self) => k.tref("std.list", k.tref(self))]]]]);
  const grove = k.type("grove", [], [["leaf", [["value", () => k.tref("type.number")]]], ["rows", [["rows", (self) => k.tref("std.list", k.tref("std.list", k.tref(self)))]]]]);
  const listFold = (name: string, nil: () => Id, f: (h: Id, r: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["xs"], (xs) => k.fold(xs, [
      { variant: NIL, names: [], body: nil },
      { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => f(h, r!) },
    ])));
    return d;
  };
  const sum = listFold("sum", () => k.lit(0), (h, r) => k.call(B.add, h, r));
  const most = listFold("most", () => k.lit(0), (h, r) => k.if(k.call(S.less, h, r), r, h));
  const sums = listFold("sums", () => k.lit(0), (h, r) => k.call(B.add, k.call(sum, h), r));
  const node = rose.v.node;
  const total = k.def("total"), depth = k.def("depth"), mirror = k.def("mirror"), scaled = k.def("scaled"), groveTotal = k.def("grove total");
  k.define(total, k.fn(["t"], (t) => k.fold(t, [
    { variant: node, names: ["v", "ks"], results: [null, "totals"], body: ([v], [, ts]) => k.call(B.add, v, k.call(sum, ts!)) },
  ])));
  k.define(depth, k.fn(["t"], (t) => k.fold(t, [
    { variant: node, names: ["v", "ks"], results: [null, "depths"], body: (_, [, ds]) => k.call(B.add, k.lit(1), k.call(most, ds!)) },
  ])));
  // A fold whose value is a tree again, and one that uses a value from around it.
  k.define(mirror, k.fn(["t"], (t) => k.fold(t, [
    { variant: node, names: ["v", "ks"], results: [null, "ms"], body: ([v], [, ms]) => k.call(node, k.call(B.sub, k.lit(0), v), ms!) },
  ])));
  k.define(scaled, k.fn(["by", "t"], (by, t) => k.fold(t, [
    { variant: node, names: ["v", "ks"], results: [null, "totals"], body: ([v], [, ts]) => k.call(B.add, k.call(B.mul, v, by), k.call(sum, ts!)) },
  ])));
  k.define(groveTotal, k.fn(["g"], (g) => k.fold(g, [
    { variant: grove.v.leaf, names: ["v"], body: ([v]) => v },
    { variant: grove.v.rows, names: ["rs"], results: ["totals"], body: (_, [ts]) => k.call(sums, ts!) },
  ])));
  // With Choice: each node counts or not, so a tree of n nodes has 2ⁿ totals, and the
  // children's folded values are a List of searches' answers.
  const some = k.def("some"), ways = k.def("ways"), firstOver = k.def("first over");
  k.define(some, k.fn(["t"], (t) => k.fold(t, [
    { variant: node, names: ["v", "ks"], results: [null, "totals"], body: ([v], [, ts]) => k.call(B.add, k.call(S.oneOf, k.list(k.lit(0), v)), k.call(sum, ts!)) },
  ])));
  k.define(ways, k.fn(["t"], (t) => k.call(S.count, k.thunk(() => k.call(some, t)))));
  k.define(firstOver, k.fn(["n", "t"], (n, t) => k.call(S.first, k.thunk(() => k.let("x", k.call(some, t), (x) => k.if(k.call(S.less, n, x), x, k.call(S.fail)))), k.thunk(() => k.lit(-1)))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), rose, grove, defs: { total, depth, mirror, scaled, groveTotal, ways, firstOver } };
}

// Each Math function once, for WebAssembly with no JavaScript host.
export function maths() {
  const k = new Lang();
  const one = (name: string, op: Id) => { const d = k.def(name); k.define(d, k.fn(["x"], (x) => k.call(op, x))); return d; };
  const two = (name: string, op: Id) => { const d = k.def(name); k.define(d, k.fn(["x", "y"], (x, y) => k.call(op, x, y))); return d; };
  // A WASI command needs a main; this one exits with 0.
  const main = k.def("main");
  k.define(main, k.fn([], () => k.lit(0)));
  const defs = { main, sin: one("sin of", B.sin), cos: one("cos of", B.cos), tan: one("tan of", B.tan), exp: one("exp of", B.exp), log: one("log of", B.log), pow: two("pow of", B.pow), atan2: two("atan2 of", B.atan2) };
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs };
}

// Fractions (std.rational, the prelude's arithmetic under the one generic
// + − · <) on Ints given in: each answer shown as text, so every target
// prints what the evaluator does. `fraction` and `÷` have no answer at a
// zero bottom; `twice` is one generic definition used at Rational and Int.
export function fractions() {
  const k = new Lang(LIBRARY.code);
  const lib = (name: string) => LIBRARY.code.defs.find((x) => LIBRARY.names[x] === name)!;
  const [fraction, divide, show] = ["fraction", "divide fractions", "show fraction"].map(lib);
  const d = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const x = k.def(name); k.define(x, k.fn(params, body)); return x; };
  const two = (name: string, op: (x: Id, y: Id) => Id) => d(name, ["a", "b", "c", "e"], (a, b, c, e) => k.call(show, op(k.call(fraction, a, b), k.call(fraction, c, e))));
  const twice = d("twice", ["x"], (x) => k.call(ARITH.add, x, x));
  const defs = {
    lowest: d("lowest", ["a", "b"], (a, b) => k.call(show, k.call(fraction, a, b))),
    sum: two("sum", (x, y) => k.call(ARITH.add, x, y)),
    difference: two("difference", (x, y) => k.call(ARITH.sub, x, y)),
    product: two("product", (x, y) => k.call(ARITH.mul, x, y)),
    quotient: two("quotient", (x, y) => k.call(divide, x, y)),
    negated: d("negated", ["a", "b"], (a, b) => k.call(show, k.call(ARITH.neg, k.call(fraction, a, b)))),
    less: d("less", ["a", "b", "c", "e"], (a, b, c, e) => k.call(ARITH.less, k.call(fraction, a, b), k.call(fraction, c, e))),
    doubled: d("doubled", ["a", "b"], (a, b) => k.call(show, k.call(twice, k.call(fraction, a, b)))),
    doubledInt: d("doubled int", ["n"], (n) => k.call(twice, k.call(INT_OPS.add, n, k.int(0)))),
  };
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names, undefined, checkOptions), defs };
}

// Ints for fractions(): zero, ±1, small, around 2³¹, 2⁵³, 2⁶² and 2⁶⁴ (where
// each target's Int changes form), and past them; then tuples of n of them.
export function fractionInputs(n: number, count: number): bigint[][] {
  const edges = [0n, 1n, -1n, 2n, -3n, 6n, -8n, 10n, 12n, 2n ** 31n, 2n ** 31n - 1n, 2n ** 53n + 1n, -(2n ** 53n), 2n ** 62n - 1n, 2n ** 62n, -(2n ** 62n), 2n ** 63n, 2n ** 64n + 6n, 3n ** 50n, -(10n ** 30n), 2n ** 100n];
  let seed = 5n;
  const next = () => (seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n);
  const pick = () => { const r = next() % 10n; return r < 4n ? edges[Number(next() % BigInt(edges.length))] : r < 8n ? (next() % 200n) - 100n : (next() * next()) * (next() % 2n ? 1n : -1n) * 6n; };
  return Array.from({ length: count }, () => Array.from({ length: n }, pick));
}

// compare (L66) at each kind of plain type, and the prelude's sort, which
// is written with it: Float64s, Ints, Text, Bools, lists, pairs, an
// Optional's cases and fractions by value.
export function ordered() {
  const k = new Lang(LIBRARY.code);
  const lib = (name: string) => LIBRARY.code.defs.find((x) => LIBRARY.names[x] === name)!;
  const d = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const x = k.def(name); k.define(x, k.fn(params, body)); return x; };
  const cmp = (a: Id, b: Id) => k.call(COMPARE, a, b);
  const int = (x: Id) => k.call(INT_OPS.add, x, k.int(0)), txt = (x: Id) => k.call(S.concat, x, k.lit(""));
  const ints = (xs: Id) => k.call(lib("map"), xs, k.fn(["n"], (n) => int(n)));
  // Each text with how many times it comes, in a Map.
  const tally = k.def("tally");
  k.define(tally, k.fn(["ts", "m"], (ts, m) => k.match(ts, [
    { variant: NIL, names: [], body: () => m },
    { variant: CONS, names: ["t", "rest"], body: ([t, rest]) => k.call(tally, rest, k.call(lib("put"), m, txt(t), k.call(S.first, k.thunk(() => k.call(INT_OPS.add, k.call(lib("value at"), m, t), k.int(1))), k.thunk(() => k.int(1))))) },
  ])));
  const maybe = (x: Id) => k.if(k.call(S.less, x, k.lit(0)), NONE, k.call(SOME, x));
  const defs = {
    numbers: d("numbers", ["x", "y"], (x, y) => cmp(k.call(B.add, x, k.lit(0)), y)),
    ints: d("ints", ["a", "b"], (a, b) => cmp(int(a), b)),
    texts: d("texts", ["s", "t"], (s, t) => cmp(txt(s), t)),
    bools: d("bools", ["x", "y"], (x, y) => cmp(k.call(S.less, x, k.lit(0)), k.call(S.less, y, k.lit(0)))),
    lists: d("lists", ["xs", "ys"], (xs, ys) => cmp(ints(xs), ys)),
    pairs: d("pairs", ["s", "xs", "t", "ys"], (s, xs, t, ys) => cmp(k.call(PAIR_V, txt(s), ints(xs)), k.call(PAIR_V, t, ys))),
    options: d("options", ["x", "y"], (x, y) => cmp(maybe(x), maybe(y))),
    fractions: d("fractions", ["a", "b", "c", "e"], (a, b, c, e) => cmp(k.call(lib("fraction"), a, b), k.call(lib("fraction"), c, e))),
    sorted: d("sorted", ["xs"], (xs) => k.call(lib("sort"), ints(xs))),
    sortedTexts: d("sorted texts", ["ts"], (ts) => k.call(lib("sort"), k.call(lib("map"), ts, k.fn(["t"], (t) => txt(t))))),
    // Maps and sets (L65) keep their entries in compare's order.
    counted: d("counted", ["ts"], (ts) => k.call(lib("entries of"), k.call(tally, ts, k.x(lib("empty map"))))),
    unique: d("unique", ["xs", "ys"], (xs, ys) => k.call(lib("items of"), k.call(lib("set union"), k.call(lib("as set"), ints(xs)), k.call(lib("as set"), ys)))),
  };
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names, undefined, checkOptions), defs };
}

// Inputs for ordered(), by function: near and equal Float64s, Ints past
// 2⁶⁴, texts by code point (é after z, emoji after both), lists that share
// a start, fractions with zero bottoms.
export function orderedInputs(): Record<string, unknown[][]> {
  let seed = 9n;
  const next = () => Number((seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n) >> 33n);
  const of = <T>(xs: T[]) => xs[next() % xs.length];
  const nums = [0, -0, 1, -1, 0.5, 1 + 1e-12, 3, -2.5, 1e300, -1e300, 5e-324];
  const ints = [0n, 1n, -1n, 7n, -7n, 2n ** 31n, 2n ** 53n + 1n, 2n ** 62n, -(2n ** 63n), 2n ** 64n, -(10n ** 30n), 2n ** 100n];
  const texts = ["", "a", "ab", "b", "z", "é", "🎉", "aa", "A", "a b"];
  const list = (n: number) => Array.from({ length: n }, () => of(ints));
  const many = <T>(count: number, make: () => T[]) => Array.from({ length: count }, make);
  return {
    numbers: many(200, () => [of(nums), of(nums)]),
    ints: many(200, () => [of(ints), of(ints)]),
    texts: many(200, () => [of(texts), of(texts)]),
    bools: many(20, () => [of([-1, 1]), of([-1, 1])]),
    lists: many(200, () => { const xs = list(next() % 4); return [xs, next() % 2 ? [...xs, ...list(next() % 3)] : list(next() % 4)]; }),
    pairs: many(100, () => [of(texts), list(next() % 3), of(texts), list(next() % 3)]),
    options: many(50, () => [of([-1, 0, 1, 2]), of([-1, 0, 1, 2])]),
    fractions: many(200, () => [of(ints), of([...ints, 0n, 3n, -6n]), of(ints), of([...ints, 2n, -4n])]),
    sorted: [[[]], [list(1)], [list(2)], [list(9)], [list(300)], [Array.from({ length: 200 }, (_, i) => BigInt((i * 37) % 11))]],
    sortedTexts: [[[]], [texts], [[...texts].reverse()], [many(150, () => of(texts))]],
    counted: [[[]], [texts], [many(100, () => of(texts))]],
    unique: many(30, () => [list(next() % 8), list(next() % 8)]),
  };
}

// A program's own effects whose operations never return (C34), compiled as
// Abort is: handled, one going on out through a handler of another (and
// through a handler of Abort, and first), and an arm that performs its
// sibling operation, which reaches the next handler out.
export function escapes() {
  const k = new Lang(LIBRARY.code);
  const d = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const x = k.def(name); k.define(x, k.fn(params, body)); return x; };
  const txt = (x: Id) => k.call(S.concat, x, k.lit(""));
  const cat = (...xs: Id[]) => xs.reduceRight((b, a) => k.call(S.concat, a, b));
  const bad = k.effect("Bad", [["invalid", [["line", () => k.tref(INT)], ["why", () => k.tref(STRING)]], null], ["stop", [], null]]);
  const { invalid, stop } = bad.op;
  const quit = k.effect("Quit", [["quit", [["code", () => k.tref(INT)]], null]]);
  const is = (t: Id, v: string) => k.equal(txt(t), k.lit(v));
  const check = d("check", ["t"], (t) => k.if(is(t, ""), k.call(stop), k.if(is(t, "x"), k.call(invalid, k.int(1), k.lit("an x")),
    k.if(is(t, "a"), k.call(ABORT_OP, k.lit("an a")), cat(t, k.lit("!"))))));
  const through = d("through", ["t"], (t) => k.let("s", k.call(check, t), (s) => cat(k.lit("<"), s, k.lit(">"))));
  const defs = {
    handled: d("handled", ["t"], (t) => k.match(k.call(through, t), [
      { variant: invalid, names: ["line", "why"], body: ([l, w]) => cat(k.call(INT_OPS.show, l), k.lit(": "), w) },
      { variant: stop, names: [], body: () => k.lit("stopped") },
    ])),
    twoEffects: d("two effects", ["t"], (t) => k.match(k.match(k.if(is(t, "q"), k.call(quit.op.quit, k.int(7)), k.call(check, t)), [
      { variant: invalid, names: ["line", "why"], body: ([, w]) => w },
      { variant: stop, names: [], body: () => k.lit("stop") },
    ]), [{ variant: quit.op.quit, names: ["code"], body: ([c]) => cat(k.lit("quit "), k.call(INT_OPS.show, c)) }])),
    pastAbort: d("past abort", ["t"], (t) => k.match(k.match(k.call(check, t), [{ variant: ABORT_OP, names: ["reason"], body: ([r]) => cat(k.lit("abort: "), r) }]), [
      { variant: invalid, names: ["line", "why"], body: ([, w]) => w },
      { variant: stop, names: [], body: () => k.lit("stop") },
    ])),
    inFirst: d("in first", ["t"], (t) => k.match(k.call(S.first, k.thunk(() => k.if(is(t, "y"), k.call(S.fail), k.call(check, t))), k.thunk(() => k.lit("none"))), [
      { variant: invalid, names: ["line", "why"], body: ([, w]) => w },
      { variant: stop, names: [], body: () => k.lit("stop") },
    ])),
    armRaises: d("arm raises", ["t"], (t) => k.match(k.match(k.call(check, t), [
      { variant: invalid, names: ["line", "why"], body: () => k.call(stop) },
      { variant: stop, names: [], body: () => k.lit("inner") },
    ]), [{ variant: invalid, names: ["line", "why"], body: () => k.lit("outer invalid") }, { variant: stop, names: [], body: () => k.lit("outer") }])),
  };
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs };
}

// A recursive let (BACKLOG L84): `go` lives inside `scaled sum`, calls
// itself, and uses `c` from around it. lift-lets.ts makes it a definition
// before any target sees it.
export function recursiveLets() {
  const k = new Lang();
  const scaledSum = k.def("scaled sum");
  k.define(scaledSum, k.fn(["xs", "c"], (xs, c) => {
    let go = "";
    const scope = k.lambda(["go"], (g) => ((go = g), k.call(g, xs)));
    return k.call(scope, k.fn(["ys"], (ys) => k.match(ys, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], body: ([h, t]) => k.call(B.add, k.call(B.mul, h, c), k.call(go, t)) },
    ])));
  }));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), scaledSum };
}

// Projective geometric algebra, [1, 1, 1, 0], on a record of 16 Float64s
// (C65): the product with the algebra given as data, a motor given later,
// a motor known now, and a point (x, y, z, w) moved by it, w e₁₂₃ − x e₂₃₀
// + y e₁₃₀ − z e₁₂₀ (Gunn and De Keninck's point; e₀ is the fourth vector
// here). The motor turns by 90° about z, then moves by 5 along x.
export function pga() {
  const k = new Lang(LIBRARY.code);
  const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
  const num = () => k.tref(NUMBER);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const size = 16;
  const M = k.type("Pga", [], [["pga", Array.from({ length: size }, (_, i) => [`p${i}`, num] as [string, () => Id])]]);
  const of = (...ps: Id[]) => k.call(M.v.pga, ...ps);
  const at = (parts: Record<number, number>) => of(...Array.from({ length: size }, (_, i) => k.lit(parts[i] ?? 0)));
  const basis = def("pga basis", () => k.list(...Array.from({ length: size }, (_, i) => at({ [i]: 1 }))));
  const squares = () => k.list(...[1, 1, 1, 0].map((x) => k.lit(x)));
  const algebra = def("pga", () => k.call(lib("clifford algebra"), squares(), k.x(basis)));
  const call = (f: string, ...xs: Id[]) => k.call(lib(f), k.x(algebra), ...xs);
  const mul = (a: Id, b: Id) => call("clifford product", a, b);
  const P = k.type("Point", [], [["point", ["x", "y", "z", "w"].map((p) => [p, num] as [string, () => Id])]]);
  const part = (i: number) => M.f[`pga.p${i}`], coord = (c: string) => P.f[`point.${c}`];
  const neg = (x: Id) => k.call(B.neg, x);
  const toPga = def("to pga", () => k.fn(["p"], (p) => of(...Array.from({ length: size }, (_, i) =>
    i === 7 ? k.call(coord("w"), p) : i === 14 ? neg(k.call(coord("x"), p)) : i === 13 ? k.call(coord("y"), p) : i === 11 ? neg(k.call(coord("z"), p)) : k.lit(0)))));
  const fromPga = def("from pga", () => k.fn(["m"], (m) => k.call(P.v.point, neg(k.call(part(14), m)), k.call(part(13), m), neg(k.call(part(11), m)), k.call(part(7), m))));
  const motor = def("motor", () => mul(call("clifford exp", at({ 9: 2.5 })), call("clifford exp", at({ 3: -Math.PI / 4 }))));
  const product = def("product", () => k.fn(["a", "b"], (a, b) => mul(a, b)));
  const moveBy = def("move by", () => k.fn(["m", "p"], (m, p) => call("clifford sandwich", m, p)));
  const moveFixed = def("move fixed", () => k.fn(["p"], (p) => call("clifford sandwich", k.x(motor), p)));
  const movePoint = def("move point", () => k.fn(["p"], (p) => k.call(fromPga, call("clifford sandwich", k.x(motor), k.call(toPga, p)))));
  // Generic code given the algebra as a value (I86): a space holding it,
  // passed on from one function to the next.
  const S = k.type("Space", [], [["space", [["algebra", () => k.tref("std.algebra", k.tref(M.def))]]]]);
  const sandwichIn = def("sandwich in", () => k.fn(["s", "m", "p"], (s, m, p) => k.call(lib("clifford sandwich"), k.call(S.f["space.algebra"], s), m, p)));
  const moveIn = def("move in", () => k.fn(["s", "p"], (s, p) => k.call(fromPga, k.call(sandwichIn, s, k.x(motor), k.call(toPga, p)))));
  const space = def("pga space", () => k.call(S.v.space, k.x(algebra)));
  const moveGiven = def("move given", () => k.fn(["p"], (p) => k.call(moveIn, k.x(space), p)));
  // Given a list of points as well, the call can't be worked out whole:
  // `total x in` gets a copy for the space instead.
  const totalIn = def("total x in", () => k.fn(["s", "ps"], (s, ps) => k.fold(ps, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.call(B.add, k.call(coord("x"), k.call(moveIn, s, h)), r!) },
  ])));
  const totalGiven = def("total given", () => k.fn(["ps"], (ps) => k.call(totalIn, k.x(space), ps)));
  // A multivector given to a definition only its own callers call (L43c):
  // `moved n times` is only ever given a point, moved or not (its blade
  // mask, 4 of the 16 parts), and staging can't work it out whole (n is
  // known only when it runs), so its sandwich is staged reading those 4.
  const movedN = k.def("moved n times");
  k.define(movedN, k.fn(["q", "n"], (q, n) => k.if(k.call(STD.less, n, k.lit(1)), q, k.call(movedN, call("clifford sandwich", k.x(motor), q), k.call(B.sub, n, k.lit(1))))));
  const moveN = def("move n times", () => k.fn(["p", "n"], (p, n) => k.call(fromPga, k.call(movedN, k.call(toPga, p), n))));
  // The same on a GPU, under a budget (a shader can't loop unbounded).
  const moveNBudget = def("move n times on the GPU", () => k.fn(["p", "n"], (p, n) => within(k, 64, () => k.call(moveN, p, n), () => p)));
  // Given any multivector from outside: every part.
  const movedAnyBudget = def("moved n times on the GPU", () => k.fn(["q", "n"], (q, n) => within(k, 64, () => k.call(movedN, q, n), () => q)));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), pga: M.v.pga, point: P.v.point, defs: { product, moveBy, moveFixed, movePoint, moveGiven, totalGiven }, times: { movedN, moveN, moveNBudget, movedAnyBudget } };
}

// Int held in 32 bits, for shaders (C66c): + − × negate abs, less, as
// Float64, equal; a loop under a budget; a cube that passes 32 bits from
// 1291 on; the lowest i32.
export function ints() {
  const k = new Lang();
  const def = (name: string, params: string[], body: (...xs: string[]) => string) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const I = INT_OPS;
  const poly = def("poly", ["a", "b"], (a, b) => k.call(I.add, k.call(I.sub, k.call(I.mul, a, b), a), k.call(I.neg, k.call(I.abs, b))));
  const smaller = def("smaller", ["a", "b"], (a, b) => k.if(k.call(I.less, a, b), k.call(I.toNumber, a), k.call(I.toNumber, b)));
  const same = def("same", ["a", "b"], (a, b) => k.equal(k.call(I.abs, a), b));
  // A loop on Ints (it might not finish, as far as the checker sees), under a budget.
  const go = k.def("go");
  // `i = 0`, not `i < 1`: a count the checker can bound (L46) needs no budget, and this one is here to run out of it.
  k.define(go, k.fn(["i", "acc"], (i, acc) => k.if(k.equal(i, k.int(0)), acc, k.call(go, k.call(I.sub, i, k.int(1)), k.call(I.add, acc, i)))));
  const sumTo = def("sum to", ["n"], (n) => within(k, 1000, () => k.call(go, n, k.int(0)), () => k.int(-1)));
  // a³ past 32 bits: the budget's fallback.
  const cube = def("cube", ["a"], (a) => within(k, 10, () => k.call(I.mul, k.call(I.mul, a, a), a), () => k.int(-1)));
  const lowest = def("lowest", [], () => k.int(-2147483648));
  // Searches with one answer or none, under first with a fallback, and count.
  const or = (x: () => string, y: () => string) => k.call(S.first, k.thunk(x), k.thunk(y));
  const quot = def("quotient or", ["a", "b"], (a, b) => or(() => k.call(I.quotient, a, b), () => k.int(-7)));
  const rem = def("remainder or", ["a", "b"], (a, b) => or(() => k.call(I.remainder, a, b), () => k.int(-7)));
  const pow = def("power or", ["a", "b"], (a, b) => or(() => k.call(I.power, a, b), () => k.int(-7)));
  const whole = def("whole or", ["x"], (x) => or(() => k.call(I.wholePart, x), () => k.int(-7)));
  const counted = def("count quotients", ["a", "b"], (a, b) => k.call(S.count, k.thunk(() => k.call(I.quotient, a, b))));
  // A definition with one answer or none, its none from `fail`, and two firsts inside each other.
  const half = def("half", ["a"], (a) => k.if(k.equal(k.call(I.remainder, a, k.int(2)), k.int(0)), k.call(I.quotient, a, k.int(2)), k.call(S.fail)));
  const quarter = def("quarter or", ["a", "b"], (a, b) => or(() => k.call(half, k.call(half, a)), () => or(() => k.call(I.add, k.call(half, b), k.int(1000)), () => k.int(-1))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  if (info.errors.length) throw new Error(info.errors.map((e) => e.message).join("; "));
  return { code, names, info, poly, smaller, same, sumTo, cube, lowest, quot, rem, pow, whole, counted, quarter };
}

// std's Array in a shader (C66c): sizes fixed where each array is made.
export function shaderArrays() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, params: string[], body: (...xs: string[]) => string) => { const d = k.def(name); k.define(d, params.length ? k.fn(params, body) : body()); return d; };
  const A = ARRAY_OPS;
  const or = (x: () => string, y: () => string) => k.call(S.first, k.thunk(x), k.thunk(y));
  const palette = def("palette", ["i"], (i) => or(() => k.call(A.at, k.call(A.of, k.list(k.lit(0.1), k.lit(0.5), k.lit(0.9))), i), () => k.lit(-1)));
  const grow = def("grow", ["x"], (x) => k.let("a", k.call(A.push, k.call(A.push, k.call(A.empty), x), k.call(B.mul, x, k.lit(2))), (a) =>
    k.call(B.add, or(() => k.call(A.at, a, k.int(1)), () => k.lit(0)), k.call(INT_OPS.toNumber, k.call(A.length, a)))));
  const table = def("table", [], () => k.call(A.of, k.list(k.int(3), k.int(1), k.int(4), k.int(1), k.int(5))));
  const pick = def("pick", ["i"], (i) => or(() => k.call(INT_OPS.add, k.call(A.at, table, i), k.call(A.length, table)), () => k.int(-7)));
  const nothing = def("nothing at", ["i"], (i) => or(() => k.call(A.at, k.call(A.empty), i), () => k.lit(-1)));
  const uneven = def("uneven", ["b"], (b) => k.call(A.length, k.if(b, k.call(A.of, k.list(k.lit(1))), k.call(A.of, k.list(k.lit(1), k.lit(2))))));
  const listed = def("listed", ["x"], (x) => k.call(A.length, k.call(A.of, k.call(A.items, k.call(A.of, k.list(k.call(B.add, x, k.lit(1))))))));
  // An array as an input (C66d): a copy of `head and size` per size it is
  // called with; `loose` is called by nothing, so it has no size.
  const headSize = def("head and size", ["a"], (a) => k.call(B.add, or(() => k.call(A.at, a, k.int(0)), () => k.lit(0)), k.call(INT_OPS.toNumber, k.call(A.length, a))));
  const twoSizes = def("two sizes", ["x"], (x) => k.call(B.add, k.call(headSize, k.call(A.of, k.list(x))), k.call(headSize, k.call(A.push, k.call(A.of, k.list(x, k.lit(2))), x))));
  const loose = def("loose", ["a"], (a) => k.call(INT_OPS.toNumber, k.call(A.length, a)));
  // The two ends at fixed sizes (C66): [3x, x, 2]'s rest's first is x; the
  // rest of [1] three times is empty (the empty array's rest is itself);
  // the first of an empty array is no answer.
  const ends = def("ends", ["x"], (x) => k.call(B.add,
    or(() => k.call(A.first, k.call(A.rest, k.call(A.pushFront, k.call(A.of, k.list(x, k.lit(2))), k.call(B.mul, x, k.lit(3))))), () => k.lit(-1)),
    k.call(INT_OPS.toNumber, k.call(A.length, k.call(A.rest, k.call(A.rest, k.call(A.rest, k.call(A.of, k.list(x)))))))));
  const firstOfNone = def("first of none", ["x"], (x) => or(() => k.call(A.first, k.call(A.rest, k.call(A.of, k.list(x)))), () => k.lit(-1)));
  const code = base(k.code), names = { ...baseNames(k.names) }, info = infer(code, names, undefined, checkOptions);
  if (info.errors.length) throw new Error(info.errors.map((e) => e.message).join("; "));
  return { code, names, info, palette, grow, table, pick, nothing, uneven, listed, headSize, twoSizes, loose, ends, firstOfNone };
}

// Why `maths()`'s op stops on x and y, the program's answer where a Float64
// has none (L125c2, stops.ts), or null: log of 0 or less, and a power
// whose answer isn't finite; any other answer that isn't is an overflow,
// found as it's given back to the host.
export function stopsWith(op: string, x: number, y: number): string | null {
  if (op === "log" && x <= 0) return STOPS[3];
  const r = (Math as unknown as Record<string, (a: number, b: number) => number>)[op](x, y);
  if (Number.isFinite(r)) return null;
  return op === "pow" && x === 0 && y < 0 ? STOPS[4] : op === "pow" && x < 0 && !Number.isInteger(y) ? STOPS[5] : STOPS[6];
}
