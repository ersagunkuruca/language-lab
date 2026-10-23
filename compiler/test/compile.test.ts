// The compiler is a second implementation of the language, so the
// evaluator is its test oracle: every example program must print exactly
// the same lines both ways.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runMain, makeRunner, fromList, toList, type Value } from "../../projectional/src/lang/run.ts";
import type { Id } from "../../projectional/src/model.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { CONS, FALSE, NIL, S, SHOW_ANY, TRUE } from "../../projectional/src/lang/std.ts";
import { B } from "../../projectional/src/prelude.ts";
import { compile } from "../src/compile.ts";
import { compileProgram, load } from "../src/program.ts";
import { $setPrint } from "../src/runtime.js";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const dir = mkdtempSync(join(tmpdir(), "compiled-"));

async function compiled(name: string, exports: string[]) {
  const file = join(dir, `${name}-${exports.join("-").replace(/\W/g, "")}.js`);
  writeFileSync(file, compileProgram(name, exports, runtime));
  return (await import(pathToFileURL(file).href)).defs as Record<string, (...a: unknown[]) => unknown>;
}

function printed(run: () => void, setPrint: (p: (s: string) => void) => void): string[] {
  const lines: string[] = [];
  setPrint((s) => lines.push(s));
  run();
  return lines;
}

for (const name of ["queens", "algebra", "relations", "backwards", "calculus", "physics"]) {
  test(`${name}: compiled main prints what the evaluator prints`, async () => {
    const p = load(name);
    const want: string[] = [];
    runMain(p.code, p.info, p.named("main"), { print: (s) => want.push(s) });
    const defs = await compiled(name, ["main"]);
    const got = printed(() => defs.main(), $setPrint);
    assert.deepEqual(got, want);
    assert.ok(want.length > 3);
  });
}

test("queens: a Choice function compiles to a generator with the same stream of answers", async () => {
  const p = load("queens");
  const defs = await compiled("queens", ["queens"]);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const want = [...r.call(r.value(p.named("queens")), 6)].map((b) => fromList(b));
  const got = [...(defs.queens(6) as Iterable<Value>)].map((b) => fromList(b));
  assert.deepEqual(got, want);
  assert.equal(got.length, 4);
});

test("relations: solved directions give the solver's answers, in its order", async () => {
  const p = load("relations");
  const defs = await compiled("relations", ["split", "to polar", "square roots"]);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  // Some directions have infinitely many answers (an angle plus 2πk), so
  // compare the first few.
  const take = (xs: Iterable<Value>, n = 6) => { const out: Value[] = []; for (const x of xs) if (out.push(x) >= n) break; return out; };
  const ev = (name: string, ...args: Value[]) => take(r.call(r.value(p.named(name)), ...args));
  // split is pure: a plain function. to polar has Choice: a generator.
  assert.deepEqual(defs.split(10, 4), ev("split", 10, 4)[0]);
  for (const [x, y] of [[0, 2], [3, 4], [-1, 0], [0, 0]]) {
    assert.deepEqual(take(defs["to polar"](x, y) as Iterable<Value>), ev("to polar", x, y));
  }
  for (const y of [9, 2, 0, -1]) assert.deepEqual(defs["square roots"](y), ev("square roots", y)[0]);
});

test("an effect-polymorphic function gets one copy per calling convention", async () => {
  // map(list, change): pure when change is pure, Choice when change is.
  const k = new Lang();
  const map = k.def("map");
  k.define(map, k.fn(["list", "change"], (xs, f) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["item", "rest"], body: ([h, t]) => k.call(CONS, k.call(f, h), k.call(map, t, f)) },
  ])));
  const plain = k.def("plain");
  k.define(plain, k.thunk(() => k.call(map, k.call(S.range, k.lit(4)), k.fn(["x"], (x) => k.call(B.mul, x, x)))));
  const choices = k.def("choices");
  k.define(choices, k.thunk(() => k.call(S.all, k.thunk(() => k.call(map, k.call(S.range, k.lit(3)),
    k.fn(["x"], (x) => k.call(S.oneOf, k.list(x, k.call(B.add, x, k.lit(10))))))))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);

  const source = compile(code, info, names, { runtime, exports: ["plain", "choices"] });
  assert.match(source, /^function map\(/m);
  assert.match(source, /^function map\$choice\$k\(/m);
  const file = join(dir, "poly.js");
  writeFileSync(file, source);
  const defs = (await import(pathToFileURL(file).href)).defs;

  const r = makeRunner(code, info, { print: () => {} });
  for (const name of ["plain", "choices"]) {
    const def = code.defs.find((d) => names[d] === name)!;
    assert.deepEqual(defs[name](), [...r.call(r.value(def))][0]);
  }
  assert.equal(fromList(defs.choices()).length, 8);
});

test("a function that may choose, given one that doesn't, gets a copy that calls it plainly", async () => {
  // keep's test is typed (a) -[Choice, e]-> Bool; most tests never choose
  const k = new Lang();
  const keep = k.def("keep");
  k.define(keep, k.fn(["list", "test"], (xs, p) => k.call(S.all, k.thunk(() =>
    k.let("item", k.call(S.oneOf, xs), (x) => k.if(k.call(p, x), x, k.call(S.fail)))))));
  const small = k.def("small");
  k.define(small, k.thunk(() => k.call(keep, k.call(S.range, k.lit(5)), k.fn(["n"], (n) => k.call(S.less, n, k.lit(2))))));
  const twice = k.def("twice");
  k.define(twice, k.thunk(() => k.call(keep, k.call(S.range, k.lit(3)), k.fn(["n"], () => k.call(S.oneOf, k.list(k.true, k.false, k.true))))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const source = compile(code, info, names, { runtime, exports: ["small", "twice"] });
  assert.match(source, /^function keep\$plain\(/m);
  assert.match(source, /^function keep\(/m);
  assert.match(source, /keep\$plain\(\$range\(5\), \(\(n\) =>/);
  const file = join(dir, "plain.js");
  writeFileSync(file, source);
  const defs = (await import(pathToFileURL(file).href)).defs;
  const r = makeRunner(code, info, { print: () => {} });
  for (const name of ["small", "twice"]) {
    const def = code.defs.find((d) => names[d] === name)!;
    assert.deepEqual(defs[name](), [...r.call(r.value(def))][0]);
  }
  assert.deepEqual(fromList(defs.small()), [0, 1]);
  assert.deepEqual(fromList(defs.twice()), [0, 0, 1, 1, 2, 2]);
});

// Real-sized data: a fold without Choice is a loop, so it needs no JS stack
// per item, for chains (lists) and for trees.
async function compiledDefs(k: Lang, exports: string[], file: string) {
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const path = join(dir, file);
  const source = compile(code, info, names, { runtime, exports });
  writeFileSync(path, source);
  return { code, info, names, source, defs: (await import(pathToFileURL(path).href)).defs as Record<string, (...a: unknown[]) => unknown> };
}

test("a Choice function with at most one answer is a plain function (GAPS.md G14)", async () => {
  const k = new Lang();
  const positive = k.def("positive");
  k.define(positive, k.fn(["n"], (n) => k.if(k.call(S.less, k.lit(0), n), n, k.call(S.fail))));
  // Calls another such function, and itself.
  const down = k.def("down");
  k.define(down, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(3)), k.call(positive, n), k.call(down, k.call(B.add, n, k.lit(-2))))));
  // Calls a Choice parameter, so it may give more than one answer.
  const apply = k.def("apply");
  k.define(apply, k.fn(["f", "x"], (f, x) => k.call(f, x)));
  const picked = k.def("picked");
  k.define(picked, k.thunk(() => k.call(S.all, k.thunk(() => k.call(apply, k.x(positive), k.call(S.oneOf, k.list(k.lit(-1), k.lit(2), k.lit(5))))))));
  const downs = k.def("downs");
  k.define(downs, k.thunk(() => k.call(S.all, k.thunk(() => k.call(down, k.call(S.oneOf, k.list(k.lit(7), k.lit(8), k.lit(2), k.lit(-4))))))));
  const { code, info, names, source, defs } = await compiledDefs(k, ["picked", "downs", "positive"], "single.js");
  assert.match(source, /^function positive\(/m);
  assert.match(source, /^function down\(/m);
  assert.match(source, /^function apply\$choice\$k\(/m);
  const r = makeRunner(code, info, { print: () => {} });
  for (const name of ["picked", "downs"]) {
    const def = code.defs.find((d) => names[d] === name)!;
    assert.deepEqual(defs[name](), [...r.call(r.value(def))][0]);
  }
  assert.deepEqual(fromList(defs.picked() as Value), [2, 5]);
  assert.deepEqual(fromList(defs.downs() as Value), [1, 2, 2]);
  // Exported, it's a stream of answers like any other Choice function.
  assert.deepEqual([...(defs.positive(3) as Iterable<Value>)], [3]);
  assert.deepEqual([...(defs.positive(-3) as Iterable<Value>)], []);
});

test("searches called by name pass the rest as a function, and first still stops early (GAPS.md G11)", async () => {
  const k = new Lang();
  // An endless search: n, or else n + 1, or else n + 2, …
  const up = k.def("up from");
  k.define(up, k.fn(["n"], (n) => k.if(k.call(S.oneOf, k.list(k.true, k.false)), n, k.call(up, k.call(B.add, n, k.lit(1))))));
  const big = k.def("big square");
  k.define(big, k.thunk(() => k.call(S.first,
    k.thunk(() => k.let("x", k.call(up, k.lit(0)), (x) => k.if(k.call(S.less, k.lit(50), k.call(B.mul, x, x)), x, k.call(S.fail)))),
    k.thunk(() => k.lit(-1)))));
  const { code, info, names, source, defs } = await compiledDefs(k, ["big square"], "cps.js");
  assert.match(source, /^function up_from\$k\(/m);
  assert.doesNotMatch(source, /^function\* up_from\(/m);
  assert.equal(defs["big square"](), 8);
  const r = makeRunner(code, info, { print: () => {} });
  const def = code.defs.find((d) => names[d] === "big square")!;
  assert.deepEqual([...r.call(r.value(def))][0], 8);
});

test("a search whose answers are one record passes its fields, and builds it only where it's kept (GAPS.md G13)", async () => {
  const k = new Lang();
  const cut = k.type("cut", [], [["halves", [["a", () => k.tref("type.number")], ["b", () => k.tref("type.number")]]]]);
  const cuts = k.def("cuts");
  k.define(cuts, k.fn(["n"], (n) => k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2), k.lit(3))), (x) => k.call(cut.v.halves, x, k.call(B.sub, n, x)))));
  const products = k.def("products");
  k.define(products, k.thunk(() => k.call(S.all, k.thunk(() => k.match(k.call(cuts, k.lit(10)), [{ variant: cut.v.halves, names: ["a", "b"], body: ([a, b]) => k.call(B.mul, a, b) }])))));
  const kept = k.def("kept");
  k.define(kept, k.thunk(() => k.call(S.all, k.thunk(() => k.call(cuts, k.lit(4))))));
  const { code, info, names, source, defs } = await compiledDefs(k, ["products", "kept"], "unpacked.js");
  const body = (name: string) => source.slice(source.indexOf(`function ${name}(`), source.indexOf("\n}\n", source.indexOf(`function ${name}(`)));
  assert.match(body("cuts$k"), /k\$\d+\(x, /);
  assert.doesNotMatch(body("cuts$k") + body("products"), /halves \*\//);
  assert.match(body("kept"), /halves \*\//);
  const r = makeRunner(code, info, { print: () => {} });
  for (const name of ["products", "kept"]) {
    const def = code.defs.find((d) => names[d] === name)!;
    assert.deepEqual(defs[name](), [...r.call(r.value(def))][0]);
  }
  assert.deepEqual(fromList(defs.products() as Value), [9, 16, 21]);
});

test("steps over a list run as one loop: no list between split, keep and length (GAPS.md G16)", async () => {
  const { TEXT_OPS: T } = await import("../../projectional/src/lang/std.ts");
  const { LIBRARY } = await import("../../projectional/src/lang/library.ts");
  const k = new Lang(LIBRARY.code);
  const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
  const [keep, map, length] = [lib("keep"), lib("map"), lib("length")];
  const words = k.def("words");
  k.define(words, k.fn(["line"], (line) => k.call(length, k.call(keep, k.call(T.split, line, k.lit(" ")), k.fn(["w"], (w) => k.call(S.not, k.call(S.equal, w, k.lit(""))))))));
  const shout = k.def("shout");
  k.define(shout, k.fn(["t"], (t) => k.call(T.joinAll, k.call(map, k.call(T.characters, t), k.fn(["c"], (c) => k.text(c, k.lit("!")))), k.lit(""))));
  // A test that chooses isn't fused: it stays a call of keep.
  const either = k.def("either way");
  k.define(either, k.fn(["line"], (line) => k.call(length, k.call(keep, k.call(T.split, line, k.lit(" ")), k.fn(["w"], () => k.call(S.oneOf, k.list(k.true, k.false)))))));
  const { code, info, names, source, defs } = await compiledDefs(k, ["words", "shout", "either way"], "fused.js");
  const body = (name: string) => source.slice(source.indexOf(`function ${name}(`), source.indexOf("\n}\n", source.indexOf(`function ${name}(`)));
  assert.match(body("words"), /for \(const x\$\d+ of \$text\.split\(line, " "\)\)/);
  assert.doesNotMatch(body("words") + body("shout"), /keep|map\(|\$toList|builtin\.text/);
  assert.match(body("either_way"), /keep/);
  assert.equal(defs.words("  the night  rain "), 3);
  assert.equal(defs.shout("ab"), "a!b!");
  const r = makeRunner(code, info, { print: () => {} });
  const run = (name: string, arg: string) => [...r.call(r.value(code.defs.find((d) => names[d] === name)!), arg)];
  assert.deepEqual(defs["either way"]("a b"), run("either way", "a b")[0]);
});

test("lists that are only walked stay the arrays split makes (GAPS.md G21)", async () => {
  const { TEXT_OPS: T } = await import("../../projectional/src/lang/std.ts");
  const k = new Lang();
  // A fold from the end, so the order of the items shows.
  const rev = k.def("rev");
  k.define(rev, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit("") },
    { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.text(r!, h) },
  ])));
  const backwards = k.def("backwards");
  k.define(backwards, k.fn(["t"], (t) => k.call(rev, k.call(T.split, t, k.lit(",")))));
  const joined = k.def("joined");
  k.define(joined, k.fn(["t"], (t) => k.let("parts", k.call(T.split, t, k.lit(",")), (ps) => k.call(T.joinAll, ps, k.lit("+")))));
  const firstOf = k.def("first of");
  k.define(firstOf, k.fn(["t"], (t) => k.call(S.first, k.thunk(() => k.call(S.oneOf, k.call(T.split, t, k.lit(",")))), k.thunk(() => k.lit("none")))));
  // A list that is also matched on stays cells.
  const head = k.def("head or");
  k.define(head, k.fn(["t"], (t) => k.let("parts", k.call(T.split, t, k.lit(",")), (ps) => k.text(k.call(rev, ps), k.match(ps, [
    { variant: NIL, names: [], body: () => k.lit("") },
    { variant: CONS, names: ["h", "_"], body: ([h]) => h },
  ])))));
  const { defs, source } = await compiledDefs(k, ["rev", "backwards", "joined", "first of", "head or"], "arrays.js");
  const body = (name: string) => source.slice(source.indexOf(`function ${name}(`), source.indexOf("\n}\n", source.indexOf(`function ${name}(`)));
  assert.match(body("backwards"), /rev\$arr\(\$text\.split\(t, ","\)\)/);
  assert.doesNotMatch(body("rev$arr") + body("joined") + body("first_of"), /\$toList|builtin\.text|\.fields/);
  assert.match(body("head_or"), /builtin\.text\.split/);
  assert.equal(defs.backwards("a,b,c"), "cba");
  assert.equal(defs.rev(toList(["a", "b"])), "ba");
  assert.equal(defs.joined("a,b"), "a+b");
  assert.equal(defs["first of"]("x,y"), "x");
  assert.equal(defs["head or"]("p,q"), "qpp");
});

test("a fold over a million items compiles to a loop", async () => {
  const k = new Lang();
  const total = k.def("total");
  k.define(total, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.call(B.add, h, r!) },
  ])));
  const big = k.def("big");
  k.define(big, k.thunk(() => k.call(total, k.call(S.range, k.lit(1_000_000)))));
  const { defs } = await compiledDefs(k, ["big", "total"], "bigfold.js");
  assert.equal(defs.big(), 499999500000);
});

test("a fold that only adds Int items runs from the front, with no spine (GAPS.md G15)", async () => {
  const { INT_OPS: I } = await import("../../projectional/src/lang/std.ts");
  const k = new Lang();
  // How many items are below 3: `if item < 3 then rest + 1 else rest`.
  const small = k.def("small");
  k.define(small, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.int(0) },
    { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.if(k.call(I.less, h, k.int(3)), k.call(I.add, r!, k.int(1)), r!) },
  ])));
  // Number + is not associative in floating point, so this one keeps its order.
  const sum = k.def("sum");
  k.define(sum, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.call(B.add, h, r!) },
  ])));
  const big = k.def("big");
  k.define(big, k.thunk(() => k.call(small, k.call(I.range, k.int(1_000_000)))));
  const { source, defs } = await compiledDefs(k, ["big", "small", "sum"], "forward.js");
  const body = (name: string) => source.slice(source.indexOf(`function ${name}(`), source.indexOf("\n}\n", source.indexOf(`function ${name}(`)));
  assert.doesNotMatch(body("small"), /spine/);
  assert.match(body("sum"), /spine/);
  assert.equal(defs.big(), 3);
  assert.equal(defs.small(toList([5, 1, 2, 9, 0])), 3);
  assert.equal(defs.sum(toList([0.1, 0.2, 0.3])), 0.1 + (0.2 + (0.3 + 0)));
});

test("a generic function used at one type only compares as that type (GAPS.md G17)", async () => {
  // same(x, y) = x = y, generic. `texts` uses it on Text only; `either` is
  // used on Text and on Number, so it keeps the general $eq.
  const k = new Lang();
  const same = k.def("same"), either = k.def("either");
  k.define(same, k.fn(["x", "y"], (x, y) => k.call(S.equal, x, y)));
  k.define(either, k.fn(["x", "y"], (x, y) => k.call(S.equal, x, y)));
  const texts = k.def("texts");
  k.define(texts, k.thunk(() => k.call(S.and, k.call(same, k.lit("a"), k.lit("a")), k.call(either, k.lit("b"), k.lit("c")))));
  const numbers = k.def("numbers");
  k.define(numbers, k.thunk(() => k.call(either, k.lit(0.1 + 0.2), k.lit(0.3))));
  const { source, defs } = await compiledDefs(k, ["texts", "numbers"], "mono.js");
  const body = (name: string) => source.slice(source.indexOf(`function ${name}(`), source.indexOf("\n}\n", source.indexOf(`function ${name}(`)));
  assert.match(body("same"), /x === y/);
  assert.match(body("either"), /\$eq\(/);
  assert.equal(defs.texts().tag, FALSE);
  assert.equal(defs.numbers().tag, TRUE);
});

test("a self tail call compiles to a loop: a million steps, and each step's closures keep their own values", async () => {
  const k = new Lang();
  // count down from n, adding n each time: a loop written as tail recursion
  const down = k.def("down");
  k.define(down, k.fn(["n", "total"], (n, t) => k.if(k.call(S.less, n, k.lit(1)), t, k.call(down, k.call(B.sub, n, k.lit(1)), k.call(B.add, t, n)))));
  // a list of functions, one made per step, each remembering that step's n
  const makers = k.def("makers");
  k.define(makers, k.fn(["n", "made"], (n, made) => k.if(k.call(S.less, n, k.lit(1)), made,
    k.call(makers, k.call(B.sub, n, k.lit(1)), k.call(CONS, k.fn(["x"], (x) => k.call(B.mul, x, n)), made)))));
  const apply = k.def("apply all");
  k.define(apply, k.fn(["fs"], (fs) => k.match(fs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["f", "rest"], body: ([f, rest]) => k.call(CONS, k.call(f, k.lit(10)), k.call(apply, rest)) },
  ])));
  const small = k.def("small");
  k.define(small, k.thunk(() => k.call(apply, k.call(makers, k.lit(3), NIL))));
  const { code, info, defs } = await compiledDefs(k, ["down", "small"], "tail.js");
  assert.equal(defs.down(1_000_000, 0), 500000500000);
  const r = makeRunner(code, info, { print: () => {} });
  assert.deepEqual(fromList(defs.small() as Value), [10, 20, 30]);
  assert.deepEqual(fromList(defs.small() as Value), fromList([...r.call(r.value(small))][0]));
});

test("a fold over a deep tree compiles to a loop with its own stack, children first", async () => {
  const k = new Lang();
  const tree = k.type("tree", [], [["leaf", [["n", () => k.tref("type.number")]]], ["node", [["l", (self) => k.tref(self)], ["r", (self) => k.tref(self)]]]]);
  // show(tree): the order of the text says the children are folded left to right, before the parent.
  const render = k.def("render");
  k.define(render, k.fn(["t"], (t) => k.fold(t, [
    { variant: tree.v.leaf, names: ["n"], body: ([n]) => k.call(S.show, n) },
    { variant: tree.v.node, names: ["l", "r"], results: ["L", "R"], body: (_, [L, R]) => k.text(k.lit("("), L!, k.lit(" "), R!, k.lit(")")) },
  ])));
  const size = k.def("size");
  k.define(size, k.fn(["t"], (t) => k.fold(t, [
    { variant: tree.v.leaf, names: ["n"], body: () => k.lit(1) },
    { variant: tree.v.node, names: ["l", "r"], results: ["L", "R"], body: (_, [L, R]) => k.call(B.add, L!, R!) },
  ])));
  const { defs, code, info } = await compiledDefs(k, ["render", "size"], "treefold.js");
  const leaf = (n: number) => ({ tag: tree.v.leaf, fields: [n] });
  const node = (l: unknown, r: unknown) => ({ tag: tree.v.node, fields: [l, r] });
  const small = node(node(leaf(1), leaf(2)), leaf(3));
  const r = makeRunner(code, info, { print: () => {} });
  assert.equal(defs.render(small), "((1 2) 3)");
  assert.equal(defs.render(small), [...r.call(r.value(code.defs.find((d) => k.names[d] === "render")!), small as Value)][0]);
  // A tree 100,000 deep on the left.
  let deep: unknown = leaf(0);
  for (let i = 1; i < 100_000; i++) deep = node(deep, leaf(i));
  assert.equal(defs.size(deep), 100_000);
});

test("a rose tree (children in a list) folds the same compiled, with and without Choice", async () => {
  const k = new Lang();
  const tree = k.type("rose", [], [["node", [["value", () => k.tref("type.number")], ["kids", (self) => k.tref("std.list", k.tref(self))]]]]);
  const listFold = (name: string, f: (h: Id, r: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["xs"], (xs) => k.fold(xs, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => f(h, r!) },
    ])));
    return d;
  };
  const sum = listFold("sum", (h, r) => k.call(B.add, h, r));
  // total of the values
  const total = k.def("total");
  k.define(total, k.fn(["t"], (t) => k.fold(t, [
    { variant: tree.v.node, names: ["v", "ks"], results: [null, "totals"], body: ([v], [, ts]) => k.call(B.add, v, k.call(sum, ts!)) },
  ])));
  // with Choice: each node may count or not
  const some = k.def("some");
  k.define(some, k.fn(["t"], (t) => k.fold(t, [
    { variant: tree.v.node, names: ["v", "ks"], results: [null, "totals"], body: ([v], [, ts]) => k.call(B.add, k.call(S.oneOf, k.list(k.lit(0), v)), k.call(sum, ts!)) },
  ])));
  const { defs, code, info } = await compiledDefs(k, ["total", "some"], "rosefold.js");
  const node = (v: number, ...kids: unknown[]) => ({ tag: tree.v.node, fields: [v, toList(kids as Value[])] });
  const t = node(1, node(2), node(3, node(4)));
  const r = makeRunner(code, info, { print: () => {} });
  const ev = (name: string) => [...r.call(r.value(code.defs.find((d) => k.names[d] === name)!), t as Value)];
  assert.equal(defs.total(t), 10);
  assert.deepEqual([...(defs.some(t) as Iterable<number>)], ev("some"));
  assert.equal(ev("some").length, 16);
  const wide = node(0, ...Array.from({ length: 100_000 }, (_, i) => node(i)));
  assert.equal(defs.total(wide), 4999950000);
});

test("$eq compares long lists without the JS stack", async () => {
  const { $eq, $range } = await import("../src/runtime.js");
  assert.ok($eq($range(1_000_000), $range(1_000_000)));
  assert.ok(!$eq($range(1_000_000), $range(999_999)));
});

test("Int, text and set compile to what the evaluator does", async () => {
  const { INT_OPS: I, TEXT_OPS: T, SET } = await import("../../projectional/src/lang/std.ts");
  const { INT, STRING } = await import("../../projectional/src/lang/types.ts");
  const k = new Lang();
  const orNone = (body: () => string) => k.call(S.first, k.thunk(body), k.thunk(() => k.lit("none")));
  const fact = k.def("factorial");
  k.define(fact, k.fn(["n"], (n) => k.fold(k.call(I.range, n), [
    { variant: NIL, names: [], body: () => k.int(1) },
    { variant: CONS, names: ["i", "rest"], results: [null, "r"], body: ([i], [, r]) => k.call(I.mul, k.call(I.add, i, k.int(1)), r!) },
  ])));
  const pt = k.type("point", [], [["point", [["x", () => k.tref(INT)], ["label", () => k.tref(STRING)]]]]);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(...[
    k.call(I.show, k.call(fact, k.int(25))),
    k.call(I.show, k.call(I.add, k.int("9007199254740993"), k.int(-2))),
    orNone(() => k.call(I.show, k.call(I.quotient, k.int(-7), k.int(2)))),
    orNone(() => k.call(I.show, k.call(I.quotient, k.int(1), k.int(0)))),
    k.if(k.call(S.equal, k.call(I.mul, k.int(3), k.int(4)), k.int(12)), k.lit("equal"), k.lit("not equal")),
    k.call(T.joinAll, k.call(T.split, k.lit("a b c"), k.lit(" ")), k.lit("+")),
    k.call(I.show, k.call(T.length, k.lit("👋👋"))),
    orNone(() => k.call(I.show, k.call(T.find, k.lit("hello"), k.lit("l")))),
    k.let("p", k.call(pt.v.point, k.int(1), k.lit("a")), (p) => k.call(pt.f["point.label"], k.call(SET, pt.f["point.label"], p, k.lit("b")))),
    k.let("p", k.call(pt.v.point, k.int(1), k.lit("a")), (p) => k.call(I.show, k.call(pt.f["point.x"], k.call(SET, k.fn(["q"], (q) => k.call(pt.f["point.x"], q)), p, k.int(5))))),
    k.call(SHOW_ANY, k.list(k.call(pt.v.point, k.int(1), k.lit("a")), k.call(pt.v.point, k.int("100000000000000000000"), k.lit("b")))),
  ].map((t) => k.call(S.print, t)))));
  const { defs, code, info } = await compiledDefs(k, ["main"], "data.js");
  const want: string[] = [];
  runMain(code, info, main, { print: (s) => want.push(s), names: { ...baseNames(), ...k.names } });
  assert.deepEqual(printed(() => defs.main(), $setPrint), want);
  assert.deepEqual(want, ["15511210043330985984000000", "9007199254740991", "-4", "none", "equal", "a+b+c", "2", "2", "b", "5", '[point(1, "a"), point(100000000000000000000, "b")]']);
});

test("comes before, against a constant below the surrogates, is JS's < and still orders by code point", async () => {
  const { TEXT_OPS: T, SHOW_ANY } = await import("../../projectional/src/lang/std.ts");
  const k = new Lang();
  const inputs = ["", "a", "m", "z", "", "￿", "𝄞", "ma", "퟿"];
  const main = k.def("main");
  // "m" is narrow, so it compiles to <; "" isn't: 𝄞 (U+1D11E) comes
  // after it by code point, though its UTF-16 units come before
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.list(...inputs.flatMap((c) => [
    k.call(T.less, k.lit(c), k.lit("m")), k.call(T.less, k.lit("m"), k.lit(c)), k.call(T.less, k.lit(c), k.lit("")),
  ]))))));
  const { defs, code, info, source } = await compiledDefs(k, ["main"], "less.js");
  const want: string[] = [];
  runMain(code, info, main, { print: (s) => want.push(s), names: { ...baseNames(), ...k.names } });
  assert.deepEqual(printed(() => defs.main(), $setPrint), want);
  assert.match(source, /\("m" < "ma"\)/);
  assert.match(source, /\$text\.less\("𝄞", ""\)/);
});

// NUMBERS.md, "Folds run the way their value is stored": a fold over
// characters(t) runs on t's characters from the end, without the list,
// unless an arm reads the rest of the list itself.
test("a fold over characters(t) runs on the text, and splits it as characters does", async () => {
  const { TEXT_OPS: T, SHOW_ANY } = await import("../../projectional/src/lang/std.ts");
  const k = new Lang();
  const inputs = ["", "abc", "a𝄞b", "\uD834", "\uDD1Ex\uD834", "👋👋", "\uD834\uD834\uDD1E"];
  const marks = k.def("marks");
  k.define(marks, k.fn(["t"], (t) => k.fold(k.call(T.characters, t), [
    { variant: NIL, names: [], body: () => k.lit("") },
    { variant: CONS, names: ["c", "rest"], results: [null, "r"], body: ([c], [, r]) => k.call(S.concat, c, k.call(S.concat, k.lit("|"), r!)) },
  ])));
  const tails = k.def("tails");
  k.define(tails, k.fn(["t"], (t) => k.fold(k.call(T.characters, t), [
    { variant: NIL, names: [], body: () => k.lit(".") },
    { variant: CONS, names: ["c", "rest"], results: [null, "r"], body: ([c, rest], [, r]) => k.call(S.concat, c, k.call(S.concat, k.call(T.joinAll, rest, k.lit("")), r!)) },
  ])));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.list(...inputs.flatMap((x) => [k.call(marks, k.lit(x)), k.call(tails, k.lit(x))]))))));
  const { defs, code, info, source } = await compiledDefs(k, ["main"], "characters.js");
  const want: string[] = [];
  runMain(code, info, main, { print: (s) => want.push(s), names: { ...baseNames(), ...k.names } });
  assert.deepEqual(printed(() => defs.main(), $setPrint), want);
  assert.match(want[0], /"a\|𝄞\|b\|"/);
  const fn = (name: string) => source.slice(source.indexOf(`function ${name}(`), source.indexOf("\n}\n", source.indexOf(`function ${name}(`)));
  assert.match(fn("marks"), /charCodeAt/);
  assert.doesNotMatch(fn("marks"), /characters/);
  assert.match(fn("tails"), /builtin\.text\.characters/);
});

test("a fold over range(n) counts down from n − 1, without the list, for Number and Int", async () => {
  const { INT_OPS: I, SHOW_ANY } = await import("../../projectional/src/lang/std.ts");
  const k = new Lang();
  const marks = (name: string, range: Id, raw: boolean) => {
    const d = k.def(name);
    k.define(d, k.fn(["n"], (n) => k.fold(k.call(range, n), [
      { variant: NIL, names: [], body: () => k.list() },
      { variant: CONS, names: ["i", "rest"], results: [null, "r"], body: ([i, rest], [, r]) => k.call(CONS, raw ? k.call(SHOW_ANY, rest) : i, r!) },
    ])));
    return d;
  };
  const num = marks("numbers", S.range, false), int = marks("ints", I.range, false), tails = marks("tails", S.range, true);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.list(...[
    ...[4, 2.5, 0, -3].map((x) => k.call(num, k.lit(x))),
    k.call(num, k.call(B.div, k.lit(0), k.lit(0))),
    ...[4, 0].map((x) => k.call(int, k.int(x))),
    k.call(tails, k.lit(3)),
  ].map((x) => k.call(SHOW_ANY, x)))))));
  const { defs, code, info, source } = await compiledDefs(k, ["main"], "counted.js");
  const want: string[] = [];
  runMain(code, info, main, { print: (s) => want.push(s), names: { ...baseNames(), ...k.names } });
  assert.deepEqual(printed(() => defs.main(), $setPrint), want);
  assert.equal(want[0], '["[0, 1, 2, 3]", "[0, 1]", "[]", "[]", "[]", "[0, 1, 2, 3]", "[]", "[\\"[1, 2]\\", \\"[2]\\", \\"[]\\"]"]');
  const fn = (name: string) => source.slice(source.indexOf(`function ${name}(`), source.indexOf("\n}\n", source.indexOf(`function ${name}(`)));
  assert.doesNotMatch(fn("numbers"), /\$range/);
  assert.doesNotMatch(fn("ints"), /range/);
  assert.match(fn("tails"), /\$range/);
});

// GAPS.md G0: an Int is a JS number while it's small, so it used to get
// Number's tolerance and 10^12 = 10^12 + 1 was true, both ways.
// REVIEW-2026-10-22b.md §2: and one rule for every type, so going through a
// generic function never changes the answer.
test("equal compares whole numbers exactly and others to float precision, at every type", async () => {
  const k = new Lang();
  const same = k.def("same"), main = k.def("main");
  k.define(same, k.fn(["a", "b"], (a, b) => k.equal(a, b)));
  const big = () => k.int(1000000000000), next = () => k.int(1000000000001);
  const third = () => k.call(B.add, k.lit(0.1), k.lit(0.2));
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.list(
    k.equal(big(), next()), k.equal(k.list(big()), k.list(next())), k.call(same, big(), next()), k.call(same, k.list(big()), k.list(next())),
    k.equal(big(), big()), k.call(same, big(), big()),
    k.equal(third(), k.lit(0.3)), k.equal(k.list(third()), k.list(k.lit(0.3))), k.call(same, third(), k.lit(0.3)),
    k.equal(k.lit(1e12), k.lit(1e12 + 1)), k.call(same, k.lit(1e12), k.lit(1e12 + 1)),
  )))));
  const { defs, code, info } = await compiledDefs(k, ["main"], "equal.js");
  const want: string[] = [];
  runMain(code, info, main, { print: (s) => want.push(s), names: { ...baseNames(), ...k.names } });
  assert.deepEqual(want, ["[false, false, false, false, true, true, true, true, true, false, false]"]);
  assert.deepEqual(printed(() => defs.main(), $setPrint), want);
});

// GAPS.md G3: a function that returns Bool returns a JS boolean, and a
// match that decides a condition sets one, instead of building Bool data.
test("Bool functions and match conditions compile to JS booleans, and stay Bool data as values", async () => {
  const k = new Lang();
  const small = k.def("small"), first = k.def("first is small"), pick = k.def("pick"), map = k.def("map"), main = k.def("main");
  k.define(small, k.fn(["n"], (n) => k.call(S.less, n, k.lit(10))));
  const head = (xs: Id) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.false },
    { variant: CONS, names: ["x", "rest"], body: ([x]) => k.call(small, x) },
  ]);
  k.define(first, k.fn(["xs"], head));
  k.define(pick, k.fn(["xs"], (xs) => k.if(head(xs), k.lit("yes"), k.lit("no"))));
  k.define(map, k.fn(["list", "change"], (xs, f) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["item", "rest"], body: ([h, t]) => k.call(CONS, k.call(f, h), k.call(map, t, f)) },
  ])));
  const list = (...ns: number[]) => k.list(...ns.map((n) => k.lit(n)));
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.list(
    ...[k.call(small, k.lit(3)), k.call(small, k.lit(30)), k.call(first, list()), k.call(first, list(5))].map((b) => k.call(SHOW_ANY, b)),
    k.call(SHOW_ANY, k.call(pick, list(5))), k.call(SHOW_ANY, k.call(pick, list(50))), k.call(SHOW_ANY, k.call(map, list(1, 20), small)),
  )))));
  const { defs, code, info, source } = await compiledDefs(k, ["main", "small"], "bools.js");
  const want: string[] = [];
  runMain(code, info, main, { print: (s) => want.push(s), names: { ...baseNames(), ...k.names } });
  assert.deepEqual(printed(() => defs.main(), $setPrint), want);
  // As a value (exported, or passed to map) it's Bool data.
  assert.deepEqual(defs.small(3), { tag: TRUE, fields: [] });
  assert.doesNotMatch(source, /function small\([^)]*\) \{\n\s*return \$bool/);
  assert.match(source, /break done/);
});
