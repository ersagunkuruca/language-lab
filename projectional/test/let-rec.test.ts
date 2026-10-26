// Recursive lets (BACKLOG L84): a let's value that is a function may call
// itself by the let's name, and use the inputs of the function around it,
// so a helper can live where it's used. It's checked for termination like
// a definition, and lift-lets.ts turns it into one before anything runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { hasRecursiveLet, liftLets } from "../src/lang/lift-lets.ts";
import { CONS, NIL, S, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

// `let name = value(name) in body(name)`: the value is built with the
// let's own binder in hand.
function letRec(k: Lang, name: string, value: (self: Id) => Id, body: (self: Id) => Id): Id {
  let self = "";
  const scope = k.lambda([name], (b) => ((self = b), body(b)));
  return k.call(scope, value(self));
}

function program(k: Lang, main: Id) {
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const run = () => { const out: string[] = []; runMain(code, info, main, { print: (s) => out.push(s), names }); return out; };
  return { code, names, info, run, type: (d: Id) => showType(info.subst.zonk(info.typeOf.get(d)!), names) };
}

function occurrencesProgram() {
  const k = new Lang();
  // occurrences(xs, x) = let count = (ys) ↦ match ys { [] ↦ 0; h :: t ↦ (h = x ? 1 : 0) + count(t) } in count(xs)
  const occurrences = k.def("occurrences");
  k.define(occurrences, k.fn(["xs", "x"], (xs, x) => letRec(k, "count",
    (count) => k.fn(["ys"], (ys) => k.match(ys, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], body: ([h, t]) => k.call(B.add, k.if(k.equal(h, x), k.lit(1), k.lit(0)), k.call(count, t)) },
    ])),
    (count) => k.call(count, xs))));
  // fibonacci(n) = let step = (a, b, n) ↦ n = 0 ? a : step(b, a + b, n − 1) in step(0, 1, n)
  const fibonacci = k.def("fibonacci");
  k.define(fibonacci, k.fn(["n"], (n) => letRec(k, "step",
    (step) => k.fn(["a", "b", "k"], (a, b, i) => k.if(k.equal(i, k.lit(0)), a, k.call(step, b, k.call(B.add, a, b), k.call(B.sub, i, k.lit(1))))),
    (step) => k.call(step, k.lit(0), k.lit(1), n))));
  const main = k.def("main");
  const list = k.list(k.lit(3), k.lit(1), k.lit(3), k.lit(3));
  k.define(main, k.thunk(() => k.seq(k.call(S.print, k.call(SHOW_ANY, k.call(occurrences, list, k.lit(3)))), k.call(S.print, k.call(SHOW_ANY, k.call(fibonacci, k.lit(30)))))));
  return { ...program(k, main), occurrences, fibonacci };
}

test("a let's function calls itself, and uses the inputs around it", () => {
  const p = occurrencesProgram();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.deepEqual(p.run(), ["3", "832040"]);
});

test("a recursive let is checked for termination like a definition", () => {
  const p = occurrencesProgram();
  // Taking a list apart surely ends; counting a Float64 down might not.
  assert.equal(p.type(p.occurrences), "(List a, a) -> Float64");
  assert.equal(p.type(p.fibonacci), "(Float64) -[Diverge]-> Float64");
});

test("lifted, the helper is a definition taking what it uses from around it first", () => {
  const p = occurrencesProgram();
  assert.ok(hasRecursiveLet(p.code));
  const lifted = liftLets(p.code, p.info, p.names);
  assert.ok(!hasRecursiveLet(lifted.code));
  assert.deepEqual(lifted.info.errors.map((e) => e.message), []);
  const helpers = lifted.code.defs.filter((d) => !p.code.defs.includes(d));
  const shown = Object.fromEntries(helpers.map((d) => [lifted.names[d], showType(lifted.info.subst.zonk(lifted.info.typeOf.get(d)!), lifted.names)]));
  assert.deepEqual(shown, { count: "(a, List a) -> Float64", step: "(Float64, Float64, Float64) -[Diverge]-> Float64" });
});

test("a value that isn't a function still can't use its own name", () => {
  const k = new Lang();
  const ones = k.def("ones");
  k.define(ones, letRec(k, "ones", (self) => k.call(CONS, k.lit(1), self), (self) => self));
  const p = program(k, ones);
  assert.deepEqual(p.info.errors.map((e) => e.message), ["ones has no value here: it is used outside the function or case that introduces it"]);
});

test("the palette offers a let's name inside the function it names", async () => {
  const { fillings } = await import("../src/lang/infer.ts");
  const k = new Lang();
  const d = k.def("countdown");
  let hole = "";
  k.define(d, k.fn(["n"], (n) => letRec(k, "go", () => k.fn(["m"], () => (hole = k.hole())), (go) => k.call(go, n))));
  const p = program(k, d);
  const offered = fillings(p.code, p.info, hole).flatMap((f) => ("target" in f ? [p.names[f.target]] : []));
  assert.ok(offered.includes("go") && offered.includes("m") && offered.includes("n"), offered.join(", "));
});

test("a recursive let runs backwards: fast(n) = 8 finds n = 5", async () => {
  const { relate, showTerm } = await import("../src/lang/relate.ts");
  const k = new Lang();
  // fast(n) = let step = (a, b, k) ↦ k = 0 ? a : step(b, a + b, k − 1) in step(1, 1, n)
  const fast = k.def("fast");
  let n = "";
  k.define(fast, k.fn(["n"], (x) => ((n = x), letRec(k, "step",
    (step) => k.fn(["a", "b", "k"], (a, b, i) => k.if(k.equal(i, k.lit(0)), a, k.call(step, b, k.call(B.add, a, b), k.call(B.sub, i, k.lit(1))))),
    (step) => k.call(step, k.lit(1), k.lit(1), x)))));
  const p = program(k, fast);
  assert.deepEqual(p.info.errors, []);
  const [first] = relate(p.code, fast, { out: 8 });
  assert.equal(showTerm(first.values[n]), "5");
});
