// Small programs written for the tests and the benchmark, in the DSL.

import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { B } from "../../projectional/src/prelude.ts";
import { ABORT_OP, CONS, INT_OPS, NIL, NONE, PAIR_V, S, SECOND, SOME, TEXT_OPS } from "../../projectional/src/lang/std.ts";
import { NUMBER } from "../../projectional/src/lang/types.ts";
import type { Id } from "../../projectional/src/model.ts";
import { LIBRARY, VECTORS } from "../../projectional/src/lang/library.ts";

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
  const factOf = fuelled("fact of", (m) => k.call(fact, m)), isEven = fuelled("is even", (m) => k.if(k.call(even, m), k.lit(1), k.lit(-1)));
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
  // The same Number in every part: vec3f(x).
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
  // whatever each call passes (a Number, a Vec).
  const twice = k.def("twice ignoring");
  k.define(twice, k.fn(["x", "ignored"], (x) => k.call(B.mul, n(2), x)));
  const numbers = k.def("twice a number");
  k.define(numbers, k.fn(["x"], (x) => k.call(twice, x, x)));
  const vecs = k.def("twice a vec");
  k.define(vecs, k.fn(["x"], (x) => k.call(twice, x, k.call(vec, x, x, x))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs: { along, length, unit, diagonal, farther, walk, shoot, steps, sum, orZero, twice, numbers, vecs } };
}

// The vectors module (projectional/src/lang/vectors-source.ts) on a
// program's own point and colour types, and on plain Numbers: each module
// definition is written once, for every record of Numbers.
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
    // A Number is a record of one part.
    halfway: def("halfway", ["a"], (a) => k.call(lib("mix"), a, k.lit(10), k.lit(0.5))),
    size: def("size", ["x"], (x) => k.call(lib("magnitude"), k.call(B.neg, x))),
  };
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs, Vec, Colour };
}

// Structural equal on lists of Numbers: `same` compares two lists with
// one more number in front of each (which makes them lists of Numbers),
// by the evaluator's rule for each number.
export function sameLists() {
  const k = new Lang();
  const same = k.def("same");
  k.define(same, k.fn(["xs", "ys"], (xs, ys) => k.equal(k.call(CONS, k.lit(0), xs), k.call(CONS, k.lit(0), ys))));
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
  k.define(ten, k.lit(10));
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
