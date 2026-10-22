import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FN } from "../../invertible/src/expr.js";
import { root } from "../src/io.ts";
import { get, replace, type Code, type Id, type NodeOf } from "../src/model.ts";
import { impl } from "../src/prelude.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, loadProgram } from "../src/lang/load.ts";
import { differentiate, NotDifferentiable } from "../src/lang/derive.ts";
import { NotInvertible, relate, showTerm, type Answer } from "../src/lang/relate.ts";
import { fromList, makeRunner, runMain, toList, type Value } from "../src/lang/run.ts";
import { CONS, NIL, PAIR_V, S } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

const load = (name: string) => loadProgram(join(root, "examples", name));
const params = (code: Code, def: Id) => get(code, get(code, def, "def").body!, "lambda").params;
const take = <T,>(it: Iterable<T>, n: number) => { const out: T[] = []; if (n > 0) for (const x of it) if (out.push(x) >= n) break; return out; };
const shown = (a: Answer, port: string) => showTerm(a.values[port]);
const close = (a: number, b: number, what = "") => assert.ok(Math.abs(a - b) < 1e-6 * (1 + Math.abs(b)), `${what} ${a} ≈ ${b}`);

// A little program built in place, checked, with a runner.
function program(build: (k: Lang) => void) {
  const k = new Lang();
  build(k);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const named = (n: string) => k.code.defs.find((d) => k.names[d] === n)!;
  return { k, code, names, info, named };
}

test("a printer run backwards is a parser: show numbers, unfolded", () => {
  const p = load("backwards");
  const show = p.named("show numbers");
  const [numbers] = params(p.code, show);
  const answers = [...relate(p.code, show, { out: "1 22 333" })];
  assert.deepEqual(answers.map((a) => shown(a, numbers)), ["[1, 22, 333]"]);
  // Only the spelling show itself produces reads back.
  assert.equal([...relate(p.code, show, { out: "1  2" })].length, 0);
  assert.equal([...relate(p.code, show, { out: "01" })].length, 0);
  assert.deepEqual([...relate(p.code, show, { out: "" })].map((a) => shown(a, numbers)), ["[]"]);
});

test("map run backwards with its function known enumerates every preimage", () => {
  const p = load("backwards");
  const r = makeRunner(p.code, infer(p.code, p.pres.names), { print: () => {} });
  const map = p.named("map");
  const [list, change] = params(p.code, map);
  const answers = [...relate(p.code, map, { [change]: r.value(p.named("square")), out: toList([4, 9]) })];
  assert.deepEqual(answers.map((a) => shown(a, list)), ["[2, 3]", "[2, -3]", "[-2, 3]", "[-2, -3]"]);
});

test("an if run backwards is a choice over its arms, each checked against the condition", () => {
  const p = load("backwards");
  const m = p.named("magnitude");
  const [x] = params(p.code, m);
  assert.deepEqual([...relate(p.code, m, { out: 5 })].map((a) => shown(a, x)), ["-5", "5"]);
  assert.deepEqual([...relate(p.code, m, { out: 0 })].map((a) => shown(a, x)), ["0"]);
  assert.equal([...relate(p.code, m, { out: -1 })].length, 0);
});

test("arithmetic inside a function is solved simultaneously, through data", () => {
  // f(a, b) = pair(a + b, a − b): each equation has two unknowns, so this
  // needs elimination, not undoing one operation at a time.
  const p = program((k) => {
    const f = k.def("f");
    k.define(f, k.fn(["a", "b"], (a, b) => k.call(PAIR_V, k.call(B.add, a, b), k.call(B.sub, a, b))));
  });
  const f = p.named("f");
  const [a, b] = params(p.code, f);
  const [ans] = [...relate(p.code, f, { out: { tag: PAIR_V, fields: [10, 4] } })];
  assert.equal(shown(ans, a), "7");
  assert.equal(shown(ans, b), "3");
});

test("an answer the equations don't pin down says so, with what's left over", () => {
  const p = program((k) => {
    const total = k.def("total");
    k.define(total, k.fn(["xs"], (xs) => k.fold(xs, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["x", "rest"], results: [null, "t"], body: ([x], [, t]) => k.call(B.add, x, t!) },
    ])));
  });
  const total = p.named("total");
  const [xs] = params(p.code, total);
  const [one, two] = take(relate(p.code, total, { out: 10 }), 2);
  assert.equal(shown(one, xs), "[10]");
  assert.deepEqual(one.free, []);
  // Two numbers that add up to 10: a line of answers, not a list of them.
  assert.deepEqual(two.free, [xs]);
  assert.equal(two.residual.length, 1);
  assert.match(two.residual[0], /_\d+ \+ _\d+/);
});

test("queens runs forward through the relational interpreter, and backwards finds the size of a board", () => {
  const p = load("queens");
  const q = p.named("queens");
  const [size] = params(p.code, q);
  const r = makeRunner(p.code, infer(p.code, p.pres.names), { print: () => {} });
  const forward = [...r.call(r.value(q), 5)].map((b) => JSON.stringify(fromList(b))).sort();
  const relational = [...relate(p.code, q, { [size]: 5 })].map((a) => JSON.stringify(fromList(a.values.out as Value))).sort();
  assert.deepEqual(relational, forward);
  assert.equal(forward.length, 10);
  let steps = 0;
  const [found] = take(relate(p.code, q, { out: toList([2, 0, 3, 1]) }, { spend: () => ++steps < 5000 }), 1);
  assert.equal(shown(found, size), "4");
});

test("what can't run backwards says why", () => {
  const p = program((k) => {
    const say = k.def("say");
    k.define(say, k.fn(["x"], (x) => k.seq(k.call(S.print, k.call(S.show, x)), x)));
    const slope = k.def("slope");
    k.define(slope, k.fn(["x"], (x) => k.call(k.call(S.derivative, k.fn(["y"], (y) => k.call(B.mul, y, y))), x)));
    const apply = k.def("apply");
    k.define(apply, k.fn(["f", "x"], (f, x) => k.call(f, x)));
  });
  assert.throws(() => [...relate(p.code, p.named("say"), { out: 1 })], (e) => e instanceof NotInvertible && /printing/.test(e.message));
  // derivative and calling a function only run forward: they wait until
  // their function is known. Here it is, so slope(x) = 2x is solved...
  const [x] = (p.code.nodes[(p.code.nodes[p.named("slope")] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  assert.deepEqual([...relate(p.code, p.named("slope"), { out: 1 })].map((a) => a.values[x]), [0.5]);
  // ...but a function that isn't known can't be guessed: the call is left
  // waiting, so nothing is pinned down.
  const [answer] = relate(p.code, p.named("apply"), { out: 1 });
  assert.deepEqual(answer.free.length, 2);
  assert.deepEqual(answer.residual, ["call"]);
});

test("backwards: types say Choice, Diverge when it may unfold forever, and printing is refused", () => {
  const p = load("backwards");
  const info = infer(p.code, p.pres.names);
  assert.deepEqual(info.errors, []);
  const typeOf = (n: string) => showType(info.typeOf.get(p.named(n))!, p.pres.names);
  assert.equal(typeOf("magnitudes to"), "(Number) -> List Number");
  assert.equal(typeOf("who was greeted"), "(Text) -> Text");
  assert.equal(typeOf("cuts"), "(Text) -> List Text");
  assert.equal(typeOf("read numbers"), "(Text) -[Choice]-> List Number");
  assert.equal(typeOf("height on the ray"), "(Number, Number) -[Choice]-> Number");
  // Without fuel, the unfold's Diverge shows.
  const read = get(p.code, get(p.code, p.named("read numbers"), "def").body!, "lambda");
  const fuel = get(p.code, read.body, "call");
  const thunk = get(p.code, fuel.args[1], "lambda");
  const bare = replace(p.code, read.body, (c) => ({ ...c.nodes[thunk.body] } as never));
  assert.equal(showType(infer(bare, p.pres.names).typeOf.get(p.named("read numbers"))!, p.pres.names), "(Text) -[Choice, Diverge]-> List Number");

  const q = program((k) => {
    const say = k.def("say");
    k.define(say, k.fn(["x"], (x) => k.seq(k.call(S.print, k.call(S.show, x)), x)));
    const back = k.def("back");
    const [x] = (k.code.nodes[(k.code.nodes[say] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
    k.define(back, k.fn(["y"], (y) => k.call(S.all, k.thunk(() => k.solve(say, { out: y }, { [x]: "x" }, ({ [x]: v }) => v)))));
  });
  assert.ok(q.info.errors.some((e) => /performs Console, and a function that acts can't be run backwards/.test(e.message)), JSON.stringify(q.info.errors));
});

test("backwards: main prints what each function run backwards gives", () => {
  const p = load("backwards");
  const out: string[] = [];
  runMain(p.code, infer(p.code, p.pres.names), p.named("main"), { print: (s) => out.push(s) });
  assert.deepEqual(out, [
    "magnitudes to(5) = -5 5",
    "who was greeted(\"hello, Ada\") = Ada",
    "who was greeted(\"goodbye\") = nobody",
    "cuts(\"abc\") = |abc a|bc ab|c abc|",
    "read numbers(\"10 20 30\") = [10 20 30]",
    "read numbers(\"10  20\") = unreadable",
    "square roots of each([4, 9]) = [2 3] [2 -3] [-2 3] [-2 -3]",
    "height on the ray(3π/4, −2) = 2",
    "height on the ray(3π/4, 2) = none",
  ]);
});

// ---------------------------------------------------------------- derivatives

test("arithmetic is defined once: the evaluator uses the solver's table", () => {
  const prims = FN as unknown as Record<string, { eval: unknown }>;
  for (const op of Object.keys(impl)) assert.equal(impl[op as keyof typeof impl], prims[op].eval, op);
});

test("calculus: derivatives are generated as ordinary definitions and agree with finite differences", () => {
  const p = load("calculus");
  const info = infer(p.code, p.pres.names);
  assert.deepEqual(info.errors, []);
  const r = makeRunner(p.code, info, { print: () => {} });
  const at = (name: string, x: number) => [...r.call(r.value(p.named(name)), x)][0] as number | undefined;
  for (const f of ["cubic", "wave", "kink", "bump", "parabola", "sinc"]) {
    for (const x of [-1.5, -0.3, 0.7, 2]) {
      const h = 1e-6;
      const numeric = ((at(f, x + h) as number) - (at(f, x - h) as number)) / (2 * h);
      close(at(`${f}′`, x)!, numeric, `${f}′(${x})`);
      // and derivative(f) at run time reads the same graph
      const df = [...r.call(r.value(S.derivative), r.value(p.named(f)))][0];
      close([...r.call(df, x)][0] as number, at(`${f}′`, x)!, `derivative(${f})(${x})`);
    }
  }
  // Where sinc has no value, neither has its derivative.
  assert.equal(at("sinc′", 0), undefined);
  const typeOf = (n: string) => showType(info.typeOf.get(p.named(n))!, p.pres.names);
  assert.equal(typeOf("cubic′"), "(Number) -> Number");
  assert.equal(typeOf("sinc′"), "(Number) -[Choice]-> Number");
  assert.equal(typeOf("∂polynomial/∂x"), "(List Number, Number) -> Number");
});

test("calculus: derivative(f) at run time, Newton on real functions, zeros by running backwards", () => {
  const p = load("calculus");
  const out: string[] = [];
  runMain(p.code, infer(p.code, p.pres.names), p.named("main"), { print: (s) => out.push(s) });
  assert.deepEqual(out, [
    "cubic: f(2) = 5, f′(2) = 11, root near 1: 1.324717957",
    "wave: f(2) = -2.416146837, f′(2) = -1.909297427, root near 1: 0.739085133",
    "kink: f(2) = 4, f′(2) = 4, root near 1: 0",
    "bump: f(2) = 0.82682181, f′(2) = -0.756802495, root near 1: 0",
    "parabola: f(2) = 2, f′(2) = 4, root near 1: 1.414213562",
    "sinc: f(2) = 0.454648713, f′(2) = -0.435397775, root near 1: 3.141592654",
    "zeros of cubic: 1.324717957",
    "zeros of x² − 2: 1.414213562 -1.414213562",
  ]);
});

test("differentiate: recursion, functions passed in, and what isn't differentiable", () => {
  const p = program((k) => {
    // x^n by recursion on a count: power′ calls power′.
    const power = k.def("power");
    k.define(power, k.fn(["x", "n"], (x, n) => k.if(k.call(S.less, n, k.lit(1)), k.lit(1), k.call(B.mul, x, k.call(power, x, k.call(B.sub, n, k.lit(1)))))));
    const cube = k.def("cube");
    k.define(cube, k.fn(["x"], (x) => k.call(power, x, k.lit(3))));
    const twice = k.def("twice");
    k.define(twice, k.fn(["f", "x"], (f, x) => k.call(f, k.call(f, x))));
    const sinsin = k.def("sin sin");
    k.define(sinsin, k.fn(["x"], (x) => k.call(twice, k.fn(["y"], (y) => k.call(B.sin, y)), x)));
    const first = k.def("first item");
    k.define(first, k.fn(["x"], (x) => k.match(k.list(x), [{ variant: CONS, names: ["h", "t"], body: ([h]) => h }], k.lit(0))));
  });
  let { code, names } = p;
  for (const f of ["cube", "sin sin"]) {
    const d = differentiate(code, names, p.named(f));
    code = d.code;
    names = { ...names, ...d.names };
  }
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const r = makeRunner(code, info, { print: () => {} });
  const at = (name: string, ...xs: number[]) => [...r.call(r.value(code.defs.find((d) => names[d] === name)!), ...xs)][0] as number;
  close(at("cube′", 2), 12);
  assert.ok(code.defs.some((d) => names[d] === "∂power/∂x"), "power's own derivative was generated, and calls itself");
  close(at("sin sin′", 0.5), Math.cos(Math.sin(0.5)) * Math.cos(0.5));
  assert.throws(() => differentiate(p.code, p.names, p.named("first item")), NotDifferentiable);
});
