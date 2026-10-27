import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FN } from "../../invertible/src/expr.js";
import { root } from "../src/io.ts";
import { get, replace, type Code, type Id, type NodeOf } from "../src/model.ts";
import { impl } from "../src/prelude.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, loadProgram } from "../src/lang/load.ts";
import { differentiate, NotDifferentiable } from "../src/lang/derive.ts";
import { portLabel } from "../src/lang/equations.ts";
import { NotInvertible, relate, showTerm, type Answer } from "../src/lang/relate.ts";
import { bool, fromList, makeRunner, runMain, toList, type Value } from "../src/lang/run.ts";
import { ARITH, CONS, HTML_V, INT_OPS, NIL, PAIR_V, S, TEXT_OPS } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

const load = (name: string) => loadProgram(join(root, "examples", name));
const params = (code: Code, def: Id) => get(code, get(code, def, "def").body!, "lambda").params;
const take = <T,>(it: Iterable<T>, n: number) => { const out: T[] = []; if (n > 0) for (const x of it) if (out.push(x) >= n) break; return out; };
const shown = (a: Answer, port: string) => showTerm(a.values[port]);
const close = (a: number, b: number, what = "") => assert.ok(Math.abs(a - b) < 1e-6 * (1 + Math.abs(b)), `${what} ${a} ≈ ${b}`);

// A little program built in place, checked, with a runner.
function program(build: (k: Lang) => void, known?: Code) {
  const k = known ? new Lang(known) : new Lang();
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
  // The schedule (MODES.md) runs the recursive call, which only takes the
  // known result apart, before square's two roots: so the first item's
  // root changes fastest.
  assert.deepEqual(answers.map((a) => shown(a, list)), ["[2, 3]", "[-2, 3]", "[2, -3]", "[-2, -3]"]);
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

test("backwards: types say Choice, Diverge when the search may not end, and printing is refused", () => {
  const p = load("backwards");
  const info = infer(p.code, p.pres.names);
  assert.deepEqual(info.errors, []);
  const typeOf = (n: string) => showType(info.typeOf.get(p.named(n))!, p.pres.names);
  assert.equal(typeOf("magnitudes to"), "(Float64) -> List Float64");
  assert.equal(typeOf("who was greeted"), "(Text) -> Text");
  assert.equal(typeOf("cuts"), "(Text) -> List Text");
  assert.equal(typeOf("read numbers"), "(Text) -[Choice]-> List Float64");
  assert.equal(typeOf("height on the ray"), "(Float64, Float64) -[Choice]-> Float64");
  // Without fuel it's still only Choice: reading text back unfolds a fold,
  // but each step reads a shorter text, so it ends (modes.ts). It was
  // typed Diverge before the mode analysis.
  const read = get(p.code, get(p.code, p.named("read numbers"), "def").body!, "lambda");
  const fuel = get(p.code, read.body, "call");
  const thunk = get(p.code, fuel.args[1], "lambda");
  const bare = replace(p.code, read.body, (c) => ({ ...c.nodes[thunk.body] } as never));
  assert.equal(showType(infer(bare, p.pres.names).typeOf.get(p.named("read numbers"))!, p.pres.names), "(Text) -[Choice]-> List Float64");
  // A search that may not end is Diverge, and says why: a list from how
  // many items it has counts down whole numbers, which don't get smaller.
  const c = program((k) => {
    const count = k.def("count");
    k.define(count, k.fn(["xs"], (xs) => k.fold(xs, [
      { variant: NIL, names: [], body: () => k.int(0) },
      { variant: CONS, names: ["x", "rest"], results: [null, "n"], body: (_, [, n]) => k.call(INT_OPS.add, n!, k.int(1)) },
    ])));
    const [xs] = (k.code.nodes[(k.code.nodes[count] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
    const back = k.def("lists of");
    k.define(back, k.fn(["n"], (n) => k.solve(count, { out: n }, { [xs]: "xs" }, ({ [xs]: v }) => v)));
  });
  assert.equal(showType(c.info.typeOf.get(c.named("lists of"))!, c.names), "(Int) -[Choice, Diverge]-> List a");

  const q = program((k) => {
    const say = k.def("say");
    k.define(say, k.fn(["x"], (x) => k.seq(k.call(S.print, k.call(S.show, x)), x)));
    const back = k.def("back");
    const [x] = (k.code.nodes[(k.code.nodes[say] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
    k.define(back, k.fn(["y"], (y) => k.call(S.all, k.thunk(() => k.solve(say, { out: y }, { [x]: "x" }, ({ [x]: v }) => v)))));
  });
  assert.ok(q.info.errors.some((e) => /performs Console, and a function that acts can't be run backwards/.test(e.message)), JSON.stringify(q.info.errors));
});

test("a direction with exactly one answer has no Choice, and gives its answer", () => {
  // A Pair taken apart: a Pair is always a Pair, so each value given has
  // exactly one pair of fields (modes.ts: det, and it ends).
  const c = program((k) => {
    const make = k.def("make");
    k.define(make, k.fn(["a", "b"], (a, b) => k.call(PAIR_V, a, b)));
    const [a, b] = (k.code.nodes[(k.code.nodes[make] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
    const sum = k.def("sum of");
    k.define(sum, k.fn(["p"], (p) => k.solve(make, { out: p }, { [a]: "a", [b]: "b" }, ({ [a]: x, [b]: y }) => k.call(INT_OPS.add, x, y))));
    // Text with a prefix taken off may not have it: at most one answer.
    const greet = k.def("greet");
    k.define(greet, k.fn(["who"], (who) => k.text(k.lit("hello, "), who)));
    const [who] = (k.code.nodes[(k.code.nodes[greet] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
    const name = k.def("name in");
    k.define(name, k.fn(["t"], (t) => k.call(S.first, k.thunk(() => k.solve(greet, { out: t }, { [who]: "who" }, ({ [who]: w }) => w)), k.thunk(() => k.lit("nobody")))));
  });
  assert.deepEqual(c.info.errors, []);
  assert.equal(showType(c.info.typeOf.get(c.named("sum of"))!, c.names), "(Pair Int Int) -> Int");
  const r = makeRunner(c.code, c.info, { print: () => {} });
  assert.deepEqual([...r.call(r.value(c.named("sum of")), [...r.call(r.value(PAIR_V), 1, 2)][0])], [3]);
  assert.equal(showType(c.info.typeOf.get(c.named("name in"))!, c.names), "(Text) -> Text");
  assert.deepEqual([...r.call(r.value(c.named("name in")), "goodbye")], ["nobody"]);
});

test("inverse runs any function value backwards: a definition, a lambda, a builtin", () => {
  const inverse = Object.keys(LIBRARY.names).find((d) => LIBRARY.names[d] === "inverse" && LIBRARY.code.nodes[d]?.kind === "def")!;
  const c = program((k) => {
    const fahrenheit = k.def("as °F");
    k.define(fahrenheit, k.fn(["c"], (c) => k.call(S.show, k.call(B.add, k.call(B.mul, c, k.lit(1.8)), k.lit(32)))));
    const all = (f: Id, y: Id) => k.thunk(() => k.call(S.all, k.thunk(() => k.call(inverse, f, y))));
    k.define(k.def("from °F"), all(k.x(fahrenheit), k.lit("212")));
    k.define(k.def("halved"), all(k.fn(["x"], (x) => k.call(B.mul, x, k.lit(2))), k.lit(7)));
    k.define(k.def("parsed"), all(k.x(S.show), k.lit("2.5")));
    // A function that acts can't be searched: refused, as when solve names it.
    const loud = k.def("loud");
    k.define(loud, k.fn(["n"], (n) => k.seq(k.call(S.print, k.lit("hi")), n)));
    k.define(k.def("printed"), all(k.x(loud), k.lit(1)));
  }, LIBRARY.code);
  assert.equal(showType(c.info.typeOf.get(inverse)!, c.names), "((a) -[e]-> b, b) -[Choice, Diverge, e]-> a");
  assert.equal(c.info.errors.length, 1);
  assert.match(c.info.errors[0].message, /Console while a Choice is open/);
  const r = makeRunner(c.code, c.info, { print: () => {} });
  const run = (n: string) => fromList([...r.call(r.value(c.named(n)))][0]);
  assert.deepEqual(run("from °F"), [100]);
  assert.deepEqual(run("halved"), [3.5]);
  assert.deepEqual(run("parsed"), [2.5]);
});

test("a function in a variable, closed where it was first used, can be used where more happens", () => {
  // view is shown in a page's text (whose thunk's row is closed: a view
  // may read cells, not write them), then handed to inverse in a function
  // that also prints. Each use opens the row; else the two would clash.
  const inverse = Object.keys(LIBRARY.names).find((d) => LIBRARY.names[d] === "inverse" && LIBRARY.code.nodes[d]?.kind === "def")!;
  const c = program((k) => {
    const shown = k.def("shown");
    k.define(shown, k.fn(["view"], (view) => k.call(HTML_V.text, k.thunk(() => k.call(view, k.lit(1))))));
    const both = k.def("both");
    // (A seq's later steps are checked first: shown comes first here.)
    k.define(both, k.fn(["view", "t"], (view, t) => k.seq(
      k.call(S.print, k.call(S.show, k.call(S.first, k.thunk(() => k.call(inverse, view, t)), k.thunk(() => k.lit(0))))),
      k.call(shown, view))));
  }, LIBRARY.code);
  assert.deepEqual(c.info.errors, []);
  assert.equal(showType(c.info.typeOf.get(c.named("both"))!, c.names), "((Float64) -[Cells, Diverge, Network, Log, Time]-> Text, Text) -[Cells, Console, Diverge, Network, Log, Time]-> Html");
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
    "square roots of each([4, 9]) = [2 3] [-2 3] [2 -3] [-2 -3]",
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
  assert.equal(typeOf("cubic′"), "(Float64) -> Float64");
  assert.equal(typeOf("sinc′"), "(Float64) -[Choice]-> Float64");
  assert.equal(typeOf("∂polynomial/∂x"), "(List Float64, Float64) -> Float64");
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

// A function's ports are its parameters' ids, and an id can be all digits
// (the backwards example's greet has one, 19718686). The solve node's label
// read it as port number 19718686 and the editor stopped drawing.
test("a parameter whose id is all digits is labelled by its name", () => {
  const { code, pres: { names } } = load("backwards");
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "solve") continue;
    for (const k of [...Object.keys(n.given), ...Object.keys(n.binds)]) {
      assert.equal(typeof portLabel(code, names, n.fn, k), "string", `${n.id} ${k}`);
    }
  }
  const greet = Object.values(code.nodes).find((n): n is NodeOf<"solve"> => n.kind === "solve" && "19718686" in n.binds)!;
  assert.equal(portLabel(code, names, greet.fn, "19718686"), names["19718686"]);
  assert.equal(portLabel(code, names, "builtin.concat", "1"), "b");
});

test("whole-number sums and split run backwards, so counting words backwards doesn't guess", () => {
  const p = program((k) => {
    const count = k.def("count");
    k.define(count, k.fn(["xs"], (xs) => k.fold(xs, [
      { variant: NIL, names: [], body: () => k.int(0) },
      { variant: CONS, names: ["x", "rest"], results: [null, "n"], body: (_, [, n]) => k.call(INT_OPS.add, n!, k.int(1)) },
    ])));
    const pieces = k.def("pieces");
    k.define(pieces, k.fn(["line"], (line) => k.call(TEXT_OPS.split, line, k.lit(" "))));
  });
  const count = p.named("count"), [xs] = params(p.code, count);
  let steps = 0;
  const spend = () => ++steps < 2000;
  // n + 1 = 3 gives n = 2 before the rest of the list is unfolded: the
  // three-item list is the first answer, not one found by trying lengths.
  const [three] = take(relate(p.code, count, { out: 3 }, { spend }), 1);
  assert.equal(shown(three, xs).split(",").length, 3);
  assert.ok(steps < 20, `${steps} steps`);
  // No list has −1 items: the search goes −2, −3, … until its budget ends.
  steps = 0;
  assert.deepEqual([...relate(p.code, count, { out: -1 }, { spend })], []);
  const pieces = p.named("pieces"), [line] = params(p.code, pieces);
  assert.deepEqual([...relate(p.code, pieces, { out: toList(["a", "", "b"]) })].map((a) => shown(a, line)), ['"a  b"']);
  // A piece can't hold the separator: splitting "a b" wouldn't give it back.
  assert.deepEqual([...relate(p.code, pieces, { out: toList(["a b"]) })], []);
});

test("a search's step budget bounds the equation solver's work too", () => {
  // safe(column, placed) = true, backwards: every list of queens, with
  // equations growing per queen. The solver ran between the interpreter's
  // steps without spending, so after eight answers it never came back.
  const p = load("queens");
  let steps = 0;
  const answers = [...relate(p.code, p.named("safe"), { out: bool(true) }, { spend: () => ++steps <= 2000 })];
  assert.ok(answers.length >= 5, `${answers.length} answers`);
  // Once the budget is gone, each open branch asks once more and stops.
  assert.ok(steps < 3000, `${steps} steps`);
});

test("an arm's checks cut it before its calls run: fib(n) = 4 runs out of budget, not stack (L82)", () => {
  // fib(n) = if n = 1 or n = 2 then n else fib(n − 1) + fib(n − 2). In the
  // else arm, n ≠ 1 and n ≠ 2 wait before the calls, so a guess of n = 2
  // there is dropped before fib(0), which would recurse forever, starts.
  const k = new Lang();
  const fib = k.def("fib");
  let n = "";
  k.define(fib, k.fn(["n"], (x) => ((n = x), k.if(k.call(S.or, k.equal(x, k.lit(1)), k.equal(x, k.lit(2))), x,
    k.call(B.add, k.call(fib, k.call(B.sub, x, k.lit(1))), k.call(fib, k.call(B.sub, x, k.lit(2))))))));
  const code = base(k.code), names = baseNames(k.names);
  assert.deepEqual(infer(code, names).errors, []);
  let steps = 0;
  const spend = () => ++steps <= 5000;
  const [first] = relate(code, fib, { out: 8 }, { names, spend });
  assert.equal(showTerm(first.values[n]), "5");
  assert.ok(steps < 85, `${steps} steps`);
  // No tree adds up to 4: the search goes on until its budget ends.
  steps = 0;
  assert.deepEqual([...relate(code, fib, { out: 4 }, { names, spend })], []);
});

test("waiting equations and checks sleep until what they read is known: a step costs the same at any depth (L83)", () => {
  // Past its first answer the search walks on forever, leaving one waiting
  // equation (n = n₁ + 1) and one waiting check (n₁ ≠ 0) per level.
  // Re-reading them all at every step made 2,000 steps take about a minute.
  // fibFast was the example until L83b stopped its walk; the Fibonacci
  // numbers with signs that take turns (1, 1, 0, 1, −1, 2, −3, …) go both
  // ways, so nothing bounds them.
  const k = new Lang();
  const signed = k.def("signed"), fast = k.def("signedFib");
  let n = "";
  k.define(signed, k.fn(["a", "b", "k"], (a, b, i) => k.if(k.equal(i, k.lit(0)), a, k.call(signed, b, k.call(B.sub, a, b), k.call(B.sub, i, k.lit(1))))));
  k.define(fast, k.fn(["n"], (x) => ((n = x), k.call(signed, k.lit(1), k.lit(1), x))));
  const code = base(k.code), names = baseNames(k.names);
  let steps = 0;
  const started = Date.now();
  const answers = [...relate(code, fast, { out: 13 }, { names, spend: () => ++steps < 20000 })];
  assert.deepEqual(answers.map((a) => showTerm(a.values[n])), ["9"]);
  assert.equal(steps, 20000);
  assert.ok(Date.now() - started < 10000, `${Date.now() - started} ms`);
});

test("Int sums run backwards asleep too: fibFast over Ints past its first answer (L86b)", () => {
  const k = new Lang();
  const fib3 = k.def("fib3"), fast = k.def("fibFast");
  let n = "";
  k.define(fib3, k.fn(["a", "b", "k"], (a, b, i) => k.if(k.equal(i, k.lit(0)), a, k.call(fib3, b, k.call(ARITH.add, a, b), k.call(ARITH.sub, i, k.lit(1))))));
  k.define(fast, k.fn(["n"], (x) => ((n = x), k.call(fib3, k.lit(1), k.lit(1), x))));
  const code = base(k.code), names = baseNames(k.names);
  let steps = 0;
  const started = Date.now();
  const answers = [...relate(code, fast, { out: 8 }, { names, spend: () => ++steps < 20000 })];
  // n is found, not left waiting: a check that passes lets what woke with it run.
  assert.deepEqual(answers.map((a) => [showTerm(a.values[n]), a.residual]), [["5", []]]);
  assert.ok(Date.now() - started < 10000, `${Date.now() - started} ms`);
});

test("a search stops when a recursion can't reach its answer any more: fibFast(n) = 8 ends after n = 5 (L83b)", () => {
  // fib3(13, 21, k) = 8 can't be: every call it makes has a at 13 or more,
  // and it returns some call's a (bounds.ts, intervals with widening).
  const k = new Lang();
  const fib3 = k.def("fib3"), fast = k.def("fibFast"), halves = k.def("halves"), down = k.def("down");
  let n = "", h = "", d = "";
  k.define(fib3, k.fn(["a", "b", "k"], (a, b, i) => k.if(k.equal(i, k.lit(0)), a, k.call(fib3, b, k.call(ARITH.add, a, b), k.call(ARITH.sub, i, k.lit(1))))));
  k.define(fast, k.fn(["n"], (x) => ((n = x), k.call(fib3, k.lit(1), k.lit(1), x))));
  // The same over Float64: 0.5, 0.5, 1, 1.5, 2.5, 4, …
  k.define(halves, k.fn(["n"], (x) => ((h = x), k.call(fib3, k.lit(0.5), k.lit(0.5), x))));
  // Counting down: down(a, k) = if k = 0 then a else down(a − 1, k − 1).
  // a only falls, so once it is below 3, down(a, k) = 3 can't be.
  const count = k.def("count");
  k.define(count, k.fn(["a", "k"], (a, i) => k.if(k.equal(i, k.lit(0)), a, k.call(count, k.call(ARITH.sub, a, k.lit(1)), k.call(ARITH.sub, i, k.lit(1))))));
  k.define(down, k.fn(["k"], (x) => ((d = x), k.call(count, k.lit(10), x))));
  const code = base(k.code), names = baseNames(k.names);
  assert.deepEqual(infer(code, names).errors, []);
  const solve = (f: Id, out: number, p: string) => {
    let steps = 0;
    const answers = [...relate(code, f, { out }, { names, spend: () => ++steps < 20000 })];
    assert.ok(steps < 20000, `the search ended on its own (${steps} steps)`);
    return answers.map((a) => showTerm(a.values[p]));
  };
  assert.deepEqual(solve(fast, 8, n), ["5"]);
  assert.deepEqual(solve(fast, 144, n), ["11"]);
  // Not a Fibonacci number: no answer, and the search says so.
  assert.deepEqual(solve(fast, 9, n), []);
  assert.deepEqual(solve(halves, 4, h), ["5"]);
  assert.deepEqual(solve(down, 3, d), ["7"]);
});

// A whole literal is an Int (L86b), so x · 3 + 1 = 13 runs on Int multiply:
// a factor from the other and out when it divides exactly, x · x from its
// whole square roots.
test("Int products run backwards: x · 3 + 1 = 13, x · x = 16, and none when it doesn't divide", () => {
  const k = new Lang();
  const one = (name: string, body: (x: Id) => Id) => { const d = k.def(name); let p = ""; k.define(d, k.fn(["x"], (x) => ((p = x), body(x)))); return () => ({ d, p }); };
  const linear = one("linear", (x) => k.call(ARITH.add, k.call(ARITH.mul, x, k.lit(3)), k.lit(1)));
  // + 0 makes it Int's; x · x alone is a Float64's, as nothing fixes it.
  const square = one("square", (x) => k.call(ARITH.add, k.call(ARITH.mul, x, x), k.lit(0)));
  const zero = one("zero", (x) => k.call(ARITH.mul, k.lit(0), x));
  const code = base(k.code), names = baseNames(k.names);
  const solve = (f: () => { d: Id; p: Id }, out: number) => {
    const { d, p } = f();
    return [...relate(code, d, { out }, { names, spend: () => true })].map((a) => [showTerm(a.values[p]), a.residual.length]);
  };
  assert.deepEqual(solve(linear, 13), [["4", 0]]);
  assert.deepEqual(solve(linear, 12), []);
  assert.deepEqual(solve(square, 16), [["4", 0], ["-4", 0]]);
  assert.deepEqual(solve(square, 15), []);
  assert.deepEqual(solve(zero, 5), []);
  assert.equal(solve(zero, 0).length, 1);
});

// L90: with two sides unknown an Int operation is also an equation for the
// solver, its unknowns whole, so Int polynomials run backwards as Float64's
// do; an answer that isn't whole is none.
test("Int polynomials run backwards: x · x + x = 12 gives 3 and −4, and = 11 gives none", () => {
  const k = new Lang();
  const poly = k.def("poly");
  let p = "";
  k.define(poly, k.fn(["x"], (x) => ((p = x), k.call(ARITH.add, k.call(ARITH.add, k.call(ARITH.mul, x, x), x), k.lit(0)))));
  const code = base(k.code), names = baseNames(k.names);
  const solve = (out: number) => [...relate(code, poly, { out }, { names, spend: () => true })].map((a) => [showTerm(a.values[p]), a.residual.length]);
  assert.deepEqual(solve(12).sort(), [["-4", 0], ["3", 0]]);
  assert.deepEqual(solve(11), []);
});
