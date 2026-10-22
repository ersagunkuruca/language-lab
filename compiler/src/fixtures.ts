// Small programs written for the tests and the benchmark, in the DSL.

import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { B } from "../../projectional/src/prelude.ts";
import { CONS, NIL, NONE, PAIR_V, S, SECOND, SOME } from "../../projectional/src/lang/std.ts";
import { NUMBER } from "../../projectional/src/lang/types.ts";

// The area under x·x·x − x − 1 from `from`, in `steps` strips of width
// `width`: a numeric loop written as tail recursion, the way the language
// writes loops. Nothing gets smaller, so its type carries Diverge.
export function area() {
  const k = new Lang();
  const f = k.def("f");
  k.define(f, k.fn(["x"], (x) => k.call(B.sub, k.call(B.sub, k.call(B.mul, k.call(B.mul, x, x), x), x), k.lit(1))));
  const area = k.def("area");
  k.define(area, k.fn(["x", "width", "steps", "total"], (x, w, n, acc) =>
    k.if(k.call(S.less, n, k.lit(1)), acc,
      k.call(area, k.call(B.add, x, w), w, k.call(B.sub, n, k.lit(1)), k.call(B.add, acc, k.call(B.mul, k.call(f, x), w))))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), area, f };
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
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs: { clampish, pick, near, cube, powers, gcd, fact, even, odd, twice } };
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
  const farther = k.def("farther");
  k.define(farther, k.fn(["a", "b"], (a, b) => k.if(k.call(S.less, k.call(length, a), k.call(length, b)), b, a)));
  // Walk along the ray until 4 away from the start: a loop whose state is a Vec.
  const walk = k.def("walk");
  k.define(walk, k.fn(["p", "step", "n"], (p, step, m) => k.if(k.call(S.less, n(4), k.call(length, p)), k.call(PAIR_V, k.call(length, p), m),
    k.call(walk, k.call(vec, k.call(B.add, k.call(X, p), step), k.call(Y, p), k.call(B.add, k.call(Z, p), k.call(B.mul, n(0.5), step))), step, k.call(B.add, m, n(1))))));
  const shoot = k.def("shoot");
  k.define(shoot, k.fn(["x", "y", "t"], (x, y, t) => k.call(along, k.call(Ray.v.ray, k.call(vec, x, y, n(-2)), k.call(vec, k.call(B.neg, x), n(0.5), n(1))), t)));
  const steps = k.def("steps");
  k.define(steps, k.fn(["x", "step"], (x, step) => k.call(SECOND, k.call(walk, k.call(vec, x, n(1), n(0)), step, n(0)))));
  const sum = k.def("sum");
  k.define(sum, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => n(0) },
    { variant: CONS, names: ["x", "rest"], results: [null, "s"], body: ([x], [, s]) => k.call(B.add, x, s!) },
  ])));
  const orZero = k.def("or zero");
  k.define(orZero, k.fn(["o"], (o) => k.match(o, [{ variant: SOME, names: ["x"], body: ([x]) => x }, { variant: NONE, names: [], body: () => n(0) }])));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), defs: { along, length, farther, walk, shoot, steps, sum, orZero } };
}
