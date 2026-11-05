// The numbers module (BACKLOG L207): the library's number types written in
// the language, out of std.ts, each with its + − · ÷, its Trig and its
// embedding as implementations found by its type. Dual is the first
// (L207a); Rational, Complex, Fixed and the matrices follow.
//
// Dual numbers (INTERFACES.md step 3): value + slope·ε with ε² = 0, so a
// function given dual(x, 1) gives its value and its slope at x. + and −
// are part by part, · is the product rule, (a + a′ε)(b + b′ε) = ab +
// (ab′ + a′b)ε, and Trig is the chain rule. The textbook construction
// (W. K. Clifford, 1873; forward-mode automatic differentiation,
// Wengert 1964).

import { merge, type Id } from "../model.ts";
import { B, prelude } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { ARITHMETIC_V, DIVISION_V, EMBEDDING_V, S, TIMES_V, TRIG_V, std } from "./std.ts";
import { NUMBER } from "./types.ts";

// On the prelude, whose laws give Trig's fields Dual leaves to their ways.
export function buildNumbers(pre: Module): Module {
  const k = new Lang(merge(prelude, std, pre.code));
  const n = { add: (a: Id, b: Id) => k.call(B.add, a, b), sub: (a: Id, b: Id) => k.call(B.sub, a, b), mul: (a: Id, b: Id) => k.call(B.mul, a, b), div: (a: Id, b: Id) => k.call(B.div, a, b) };

  // A record of two Float64s, the same shape as Complex, so it says it is
  // its own type.
  const T = k.type("Dual", [], [["dual", [["value", () => k.tref(NUMBER)], ["slope", () => k.tref(NUMBER)]]]], "dual numbers");
  const DV = T.v.dual;
  const du = (v: Id, f: (a: Id, a1: Id) => Id, names = ["value", "slope"]) => k.match(v, [{ variant: DV, names, body: ([a, b]) => f(a, b) }]);
  const D = (a: Id, b: Id) => k.call(DV, a, b);
  const twoD = (name: string, f: (a: Id, a1: Id, b: Id, b1: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["x", "y"], (x, y) => du(x, (a, a1) => du(y, (b, b1) => f(a, a1, b, b1), ["value₂", "slope₂"]))));
    return d;
  };
  const oneD = (name: string, f: (a: Id, a1: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["x"], (x) => du(x, f)));
    return d;
  };
  const addD = twoD("add duals", (a, a1, b, b1) => D(n.add(a, b), n.add(a1, b1)));
  const subD = twoD("subtract duals", (a, a1, b, b1) => D(n.sub(a, b), n.sub(a1, b1)));
  const mulD = twoD("multiply duals", (a, a1, b, b1) => D(n.mul(a, b), n.add(n.mul(a, b1), n.mul(a1, b))));
  const negD = oneD("negate dual", (a, a1) => D(k.call(B.neg, a), k.call(B.neg, a1)));
  const divD = twoD("divide duals", (a, a1, b, b1) => k.if(k.call(S.equal, b, k.lit(0)), k.call(S.fail),
    D(n.div(a, b), n.div(n.sub(n.mul(a1, b), n.mul(a, b1)), n.mul(b, b)))));
  const sinD = oneD("dual sin", (a, a1) => D(k.call(B.sin, a), n.mul(k.call(B.cos, a), a1)));
  const cosD = oneD("dual cos", (a, a1) => D(k.call(B.cos, a), k.call(B.neg, n.mul(k.call(B.sin, a), a1))));
  // tan′ = 1 + tan², which needs no division (cos is never exactly 0 at a Float64).
  const tanD = oneD("dual tan", (a, a1) => k.let("tan", k.call(B.tan, a), (t) => D(t, n.mul(a1, n.add(k.lit(1), n.mul(t, t))))));
  const expD = oneD("dual exp", (a, a1) => k.let("eᵃ", k.call(B.exp, a), (e) => D(e, n.mul(e, a1))));
  const logD = oneD("dual log", (a, a1) => D(k.call(B.log, a), n.div(a1, a)));
  // Unpolar by the chain rule: for r = √(x² + y²), r′ = (x·x′ + y·y′)/r,
  // and atan2(y, x)′ = (x·y′ − y·x′)/r².
  const unpolarD = k.def("dual unpolar");
  const xy = (x: Id, y: Id, f: (a: Id, a1: Id, b: Id, b1: Id) => Id) => du(x, (a, a1) => du(y, (b, b1) => f(a, a1, b, b1), ["y value", "y slope"]), ["x value", "x slope"]);
  const sq = (a: Id, b: Id) => n.add(n.mul(a, a), n.mul(b, b));
  // At the origin the slopes are taken as 0, as atan2(0, 0) is taken as 0.
  k.define(unpolarD, k.fn(["length", "angle", "x", "y"], (r, t, x, y) => k.and(
    k.equal(r, xy(x, y, (a, a1, b, b1) => k.let("r", k.call(B.sqrt, sq(a, b)), (rr) => D(rr, k.if(k.call(S.equal, rr, k.lit(0)), k.lit(0), n.div(n.add(n.mul(a, a1), n.mul(b, b1)), rr)))))),
    k.equal(t, xy(x, y, (a, a1, b, b1) => k.let("r²", sq(a, b), (r2) => D(k.call(B.atan2, b, a), k.if(k.call(S.equal, r2, k.lit(0)), k.lit(0), n.div(n.sub(n.mul(a, b1), n.mul(b, a1)), r2)))))))));
  k.results(unpolarD, "length", "angle");
  const slopeAt = k.def("slope by duals");
  k.define(slopeAt, k.fn(["f", "x"], (f, x) => du(k.call(f, D(x, k.lit(1))), (_, a1) => a1)));
  const dualTable = k.def("dual table");
  k.define(dualTable, k.list(...([[1, 0, 1, 0, 1, 0], [1, 0, 0, 1, 0, 1], [0, 1, 1, 0, 0, 1]] as const).map(([a, b, c, d, e, f]) =>
    k.call(TIMES_V, D(k.lit(a), k.lit(b)), D(k.lit(c), k.lit(d)), D(k.lit(e), k.lit(f))))));
  const showD = oneD("show dual", (a, a1) => k.call(S.concat, k.call(S.show, a), k.call(S.concat,
    k.if(k.call(S.less, a1, k.lit(0)), k.lit(" − "), k.lit(" + ")), k.call(S.concat, k.call(S.show, k.call(S.abs, a1)), k.lit("ε")))));
  // A Float64 as a dual number with no derivative part, named so the
  // embedding (and a literal at Dual, through it) is a plain call.
  const asD = k.def("as dual");
  k.define(asD, k.fn(["x"], (x) => D(x, k.lit(0))));

  const impl = (name: string, v: Id, ops: Id[]) => { const d = k.def(name); k.define(d, k.call(v, ...ops.map((o) => k.x(o)))); return d; };
  const trigD = k.def("trig at dual");
  k.define(trigD, k.call(TRIG_V, ...[sinD, cosD, tanD, expD, logD].map((d) => k.x(d)), k.x(S.byItsWays), k.x(unpolarD), k.x(S.byItsWays), k.x(S.byItsWays)));
  const embedD = k.def("float64 in dual");
  k.define(embedD, k.call(EMBEDDING_V, k.x(asD)));
  const impls = [
    impl("arithmetic at dual", ARITHMETIC_V, [addD, subD, mulD, negD]),
    impl("division at dual", DIVISION_V, [divD]),
    trigD,
  ];

  const offered = [T.def, embedD, asD, slopeAt, dualTable];
  const helpers = [addD, subD, mulD, negD, divD, sinD, cosD, tanD, expD, logD, unpolarD, showD];
  const comments: Record<Id, string> = {
    [T.def]: "A dual number, value + slope·ε where ε · ε is 0: a record of two Float64s. The same + − · work on it, · by the product rule, and sin, cos, tan, exp and log by the chain rule, so f(dual(x, 1)) carries f′(x) along with f(x) (forward-mode automatic differentiation).",
    [embedD]: "Float64 in Dual: x as the dual number x + 0ε, a constant, whose slope is 0.",
    [asD]: "The Float64 x as a dual number whose derivative part is 0: a constant.",
    [addD]: "What + is at Dual. Not offered on its own: + is.",
    [subD]: "What − is at Dual. Not offered on its own: − is.",
    [mulD]: "What · is at Dual, the product rule: (a + a′ε)(b + b′ε) = ab + (ab′ + a′b)ε, since ε · ε is 0. Not offered on its own: · is.",
    [negD]: "What −x is at Dual. Not offered on its own: − is.",
    [divD]: "x ÷ y for dual numbers, the quotient rule; no answer when y's value is 0. Not offered: the one divide works on every number but Int; kept so programs saved before still open.",
    [sinD]: "sin at Dual, by the chain rule: sin(a + a′ε) = sin a + cos a · a′ε. Not offered on its own: sin is.",
    [cosD]: "cos at Dual: cos a − sin a · a′ε. Not offered on its own: cos is.",
    [tanD]: "tan at Dual: tan a + a′/cos² a · ε. Not offered on its own: tan is.",
    [expD]: "exp at Dual: eᵃ + eᵃ · a′ε. Not offered on its own: exp is.",
    [logD]: "log at Dual: log a + a′/a · ε. Not offered on its own: log is.",
    [trigD]: "How Dual does Trig: the chain rule for each. Found by its type, so not offered: sin is.",
    [slopeAt]: "f′(x), worked out by giving f the dual number x + 1ε and reading the slope of what comes back (forward-mode automatic differentiation). f must work on duals: write it with the generic + − · and Trig. derivative(f) gives the same number by differentiating f's code.",
    [dualTable]: "Dual numbers' multiplication table: 1 · 1 = 1, 1 · ε = ε, ε · 1 = ε, and ε · ε = 0, which needs no line. table product(dual table, x, y) is x · y.",
    [showD]: "A dual number as 3 + 2ε. Not offered: the one show shows every number; kept so programs saved before still open.",
  };
  const p = publish(merge(prelude, std, pre.code, k.code), k.names, [...offered, ...impls, ...helpers], merge(prelude, std, pre.code));
  if (!p.ok) throw new Error(`the numbers module can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("numbers", p.code, p.names, offered.map(at), p.pins, notes, [...impls, ...helpers].map(at));
}
