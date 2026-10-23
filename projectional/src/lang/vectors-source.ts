// The vectors module: arithmetic on points, directions and colours,
// written once for every record of Numbers. A program's own `Vec` or
// `Colour` (one case, every field a Number) gets all of it, and so does a
// plain Number; adding a colour to a position is still a type error, since
// both inputs must be the same record. Each definition is the parts
// builtins (std.ts: map parts, zip parts, total) and nothing else, so it
// runs backwards like any other function, and on a GPU it is the vector
// operation it describes (compiler/src/wgsl.ts). Published like the
// prelude (library/build.ts writes library/vectors.json).
//
// The operations are the usual vector-space ones, the same set GLSL and
// WGSL have built in (dot, length, normalize, mix, clamp), which is where
// the names come from.

import { merge, type Id } from "../model.ts";
import { B, prelude } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { S, std } from "./std.ts";

export function buildVectors(): Module {
  const k = new Lang();
  const zip = (op: Id, a: Id, b: Id) => k.call(S.zipParts, op, a, b);

  const plus = k.def("plus");
  k.define(plus, k.fn(["a", "b"], (a, b) => zip(B.add, a, b)));
  const minus = k.def("minus");
  k.define(minus, k.fn(["a", "b"], (a, b) => zip(B.sub, a, b)));
  const times = k.def("times");
  k.define(times, k.fn(["a", "b"], (a, b) => zip(B.mul, a, b)));
  const scale = k.def("scale");
  k.define(scale, k.fn(["by", "v"], (by, v) => k.call(S.mapParts, k.fn(["x"], (x) => k.call(B.mul, by, x)), v)));
  const dot = k.def("dot");
  k.define(dot, k.fn(["a", "b"], (a, b) => k.call(S.total, zip(B.mul, a, b))));
  const magnitude = k.def("magnitude");
  k.define(magnitude, k.fn(["v"], (v) => k.call(B.sqrt, k.call(dot, v, v))));
  const distance = k.def("distance");
  k.define(distance, k.fn(["a", "b"], (a, b) => k.call(magnitude, k.call(minus, a, b))));
  const unit = k.def("unit");
  k.define(unit, k.fn(["v"], (v) => k.let("length", k.call(magnitude, v), (l) => k.call(S.mapParts, k.fn(["x"], (x) => k.call(B.div, x, l)), v))));
  const mix = k.def("mix");
  k.define(mix, k.fn(["a", "b", "amount"], (a, b, t) => k.call(S.zipParts, k.fn(["x", "y"], (x, y) => k.call(B.add, x, k.call(B.mul, t, k.call(B.sub, y, x)))), a, b)));
  const clamp = k.def("clamp");
  k.define(clamp, k.fn(["v", "low", "high"], (v, lo, hi) => k.call(S.mapParts, k.fn(["x"], (x) =>
    k.let("at least low", k.if(k.call(S.less, x, lo), lo, x), (m) => k.if(k.call(S.less, m, hi), m, hi))), v)));
  const reflect = k.def("reflect");
  k.define(reflect, k.fn(["direction", "normal"], (d, n) => k.call(minus, d, k.call(scale, k.call(B.mul, k.lit(2), k.call(dot, d, n)), n))));

  const offered: Id[] = [plus, minus, times, scale, dot, magnitude, distance, unit, mix, clamp, reflect];
  const comments: Record<Id, string> = {
    [plus]: "a + b, part by part: for points, directions, colours, or any record whose fields are all Numbers. This module's operations and their names follow the built-in functions of GLSL and WGSL (influence), which a shader compiles them to.",
    [minus]: "a − b, part by part. The direction from b to a.",
    [times]: "a · b, part by part: a colour tinted by another.",
    [scale]: "Every part of v times by: a direction made longer, a colour made brighter.",
    [dot]: "The parts' products added up: how much a and b point the same way.",
    [magnitude]: "How long v is: √(v · v).",
    [distance]: "How far a is from b.",
    [unit]: "v scaled to length 1 (normalize on a GPU).",
    [mix]: "a when amount is 0, b when it is 1, and in between, part by part.",
    [clamp]: "Every part of v kept between low and high.",
    [reflect]: "A ray going this direction, bounced off a surface facing normal (normal of length 1).",
  };
  const p = publish(merge(prelude, std, k.code), k.names, offered, merge(prelude, std));
  if (!p.ok) throw new Error(`the vectors module can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("vectors", p.code, p.names, offered.map(at), p.pins, notes);
}
