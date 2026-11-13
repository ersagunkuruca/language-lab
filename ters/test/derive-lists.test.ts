// derivative and gradient through lists (L245): `ters run` differentiates
// a function that maps over a list and sums, the way a loss is written (a
// sum of squares over the data, round 15's fitting program), by forward
// mode through data: a list made from the variable has a tangent, the
// same list with each number its slope, and a lambda that captures the
// variable has one too. Checked against compiled JavaScript, which derives
// the staged code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARITH, S, TRIG_OPS } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compiledDefs, plainValue } from "../../compiler/src/core-js.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
const { add, mul, sub } = ARITH;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  // derivative may have no answer (a function value isn't known to the
  // checker): first says what then.
  const slope = (f: Id, at: number) => k.call(S.first, k.thunk(() => k.call(k.call(S.derivative, f), k.lit(at))), k.thunk(() => k.lit(-999)));
  const xs = () => k.list(k.lit(1.5), k.lit(2), k.lit(3));
  const sumMap = (list: Id, f: (x: Id) => Id) => k.call(lib("sum"), k.call(lib("map"), list, k.fn(["x"], f)));
  const num = () => k.tref(NUMBER);
  const Line = k.type("Line", [], [["line", [["slope", num], ["offset", num]]]]);
  // The data lie on y = 2x + 1; the loss of a line is its squared misses.
  const loss = def("loss", () => k.fn(["p"], (p) => sumMap(xs(), (x) => {
    const miss = k.call(sub, k.call(add, k.call(mul, k.call(Line.f["line.slope"], p), x), k.call(Line.f["line.offset"], p)), k.call(add, k.call(mul, k.lit(2), x), k.lit(1)));
    return k.call(mul, miss, miss);
  })));
  // Round 15's form: the model a function of its parameters chosen when
  // it runs (a line or an exponential), the loss its squared misses.
  const slopeOf = (p: Id) => k.call(Line.f["line.slope"], p), offsetOf = (p: Id) => k.call(Line.f["line.offset"], p);
  const valueAt = def("value at", () => k.fn(["model", "x"], (m, x) => k.if(k.call(S.less, m, k.lit(1)),
    k.fn(["p"], (p) => k.call(add, k.call(mul, slopeOf(p), x), offsetOf(p))),
    k.fn(["p"], (p) => k.call(mul, offsetOf(p), k.call(TRIG_OPS.exp, k.call(mul, slopeOf(p), x)))))));
  const misses = def("misses", () => k.fn(["model", "p"], (m, p) => sumMap(xs(), (x) => {
    const miss = k.call(sub, k.call(k.call(valueAt, m, x), p), k.call(add, k.call(mul, k.lit(2), x), k.lit(1)));
    return k.call(mul, miss, miss);
  })));
  const chosen = (m: number) => k.call(S.first, k.thunk(() => k.call(k.call(S.gradient, k.fn(["q"], (q) => k.call(misses, k.lit(m), q))), k.call(Line.v.line, k.lit(0.5), k.lit(1)))), k.thunk(() => k.call(Line.v.line, k.lit(-999), k.lit(-999))));
  const scaled = def("scaled", () => k.fn(["xs"], (list) => k.fn(["q"], (q) => sumMap(list, (x) => k.call(mul, q, x)))));
  const names = {
    // Σ q·x: Σ x = 6.5
    "linear": def("linear", () => slope(k.fn(["q"], (q) => sumMap(xs(), (x) => k.call(mul, q, x))), 2.5)),
    // Σ (q·x − 1)²: Σ 2(q·x − 1)·x at 2.5 = 63.25
    "squares": def("squares", () => slope(k.fn(["q"], (q) => sumMap(xs(), (x) => { const r = k.call(sub, k.call(mul, q, x), k.lit(1)); return k.call(mul, r, r); })), 2.5)),
    // A list made from the variable: q² + (2q)² + 3², 10q at 1.
    "made from q": def("made from q", () => slope(k.fn(["q"], (q) => sumMap(k.list(q, k.call(mul, k.lit(2), q), k.lit(3)), (x) => k.call(mul, x, x))), 1)),
    // A list captured, known only when it runs (core-derive.test's): 3.
    "captured": def("captured", () => slope(k.call(scaled, k.list(k.lit(1), k.lit(2))), 0.5)),
    // gradient of the loss at the line y = x: misses −(x + 1).
    "gradient": def("gradient", () => k.call(S.first, k.thunk(() => k.call(k.call(S.gradient, k.x(loss)), k.call(Line.v.line, k.lit(1), k.lit(0)))), k.thunk(() => k.call(Line.v.line, k.lit(-999), k.lit(-999))))),
    "chosen line": def("chosen line", () => chosen(0)),
    "chosen exp": def("chosen exp", () => chosen(1)),
  };
  const code = base(k.code), allNames = baseNames(k.names);
  return { code, names: allNames, info: infer(code, allNames, undefined, checkOptions), defs: names };
}

test("derivative through a map and a sum: ters run gives the slope compiled JavaScript gives (L245)", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const value = (n: keyof typeof p.defs) => r.value(p.defs[n]);
  const near = (a: number, b: number, what: string, within = 1e-9) => assert.ok(Math.abs(a - b) < within * (1 + Math.abs(b)), `${what}: ${a}, want ${b}`);
  near(value("linear") as number, 6.5, "linear");
  near(value("squares") as number, 63.25, "squares");
  near(value("made from q") as number, 10, "made from q");
  near(value("captured") as number, 3, "captured");
  // ∂/∂slope Σ 2·miss·x, ∂/∂offset Σ 2·miss, misses −2.5, −3, −4 at 1.5, 2, 3
  const g = (value("gradient") as { fields: number[] }).fields;
  near(g[0], 2 * (-2.5 * 1.5 - 3 * 2 - 4 * 3), "∂slope");
  near(g[1], 2 * (-2.5 - 3 - 4), "∂offset");
  // The model chosen when it runs: its gradient there, times the
  // parameters' tangent (checked against central differences).
  const loss = (m: number, a: number, b: number) => [1.5, 2, 3].reduce((s, x) => s + ((m < 1 ? a * x + b : b * Math.exp(a * x)) - (2 * x + 1)) ** 2, 0);
  for (const [m, n] of [[0, "chosen line"], [1, "chosen exp"]] as const) {
    const got = (value(n) as { fields: number[] }).fields, h = 1e-6;
    near(got[0], (loss(m, 0.5 + h, 1) - loss(m, 0.5 - h, 1)) / (2 * h), `${n} ∂slope`, 1e-6);
    near(got[1], (loss(m, 0.5, 1 + h) - loss(m, 0.5, 1 - h)) / (2 * h), `${n} ∂offset`, 1e-6);
  }
  const names = ["linear", "squares", "made from q", "captured"] as const;
  const compiled = compiledDefs(p.code, p.info, p.names, names.map((n) => p.names[p.defs[n]]));
  for (const n of names) near(plainValue(compiled[n]()) as number, value(n) as number, `${n} compiled`);
});

test("a slope that can't be read still has no answer, and the checker keeps saying so", () => {
  const k = new Lang(LIBRARY.code);
  // floor jumps: through a map it still has no slope.
  const d = k.def("rough");
  k.define(d, k.call(S.first, k.thunk(() => k.call(k.call(S.derivative, k.fn(["q"], (q) => k.call(lib("sum"), k.call(lib("map"), k.list(k.lit(1), k.lit(2)), k.fn(["x"], (x) => k.call(S.floor, k.call(mul, q, x))))))), k.lit(0.5))), k.thunk(() => k.lit(-1))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(makeRunner(code, info, { print: () => {} }).value(d) as Value, -1);
});
