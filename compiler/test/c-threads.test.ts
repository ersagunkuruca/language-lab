// A map whose function only computes, and a together whose actions only
// compute (C201), on threads in C (L101, c.ts
// `par:map`): the items share out once they have taken a millisecond, the
// function and the items marked shared so their counts change atomically,
// and the map gives what the evaluator gives: the same array, and the
// same abort, the one the library's map meets first running its items
// from the last.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { ABORT_OP, CONS, INT_OPS, NIL, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { withLibraryRepresentations } from "../../ters/src/lang/library-reps.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

// Work for an item or an action: a sum over 10000 big Ints.
const work = (k: Lang, x: Id, big: Id) => k.call(lib("sum"), k.call(lib("map"), k.call(INT_OPS.range, k.int(10000)), k.fn(["j"], (j) => k.call(INT_OPS.add, k.call(INT_OPS.mul, j, x), big))));
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

// main prints the map of `item` over 0 to n - 1, a list kept as an array
// (`array map`); `item` is given the item, a big Int and a list that
// every item reads (both shared between the threads), and some work.
// With `keep`, the keep of `item` as its test (C202).
function program(n: number, item: (k: Lang, x: Id, big: Id, list: Id, work: Id) => Id, by = "map") {
  return built(/lab_par_map_0\(/, true, (k) => k.let("big", k.call(INT_OPS.mul, k.int(1n << 40n), k.int(1n << 40n)), (big) =>
    k.let("list", k.call(INT_OPS.range, k.int(50)), (list) =>
      k.let("ys", k.call(lib(by), k.call(INT_OPS.range, k.int(n)), k.fn(["x"], (x) => item(k, x, big, list, work(k, x, big)))), (ys) =>
        // Read by position too, so the list is kept as an array (C30).
        k.seq(k.call(S.print, k.call(SHOW_ANY, k.call(L("item at"), ys, k.int(1), k.int(-1)))), k.call(S.print, k.call(SHOW_ANY, ys)))))));
}

// main prints a together of n actions, each `action` of its number, the
// big Int and some work.
function togetherProgram(n: number, action: (k: Lang, i: number, big: Id, work: Id) => Id) {
  return built(/lab_par_together_0\(/, false, (k) => k.let("big", k.call(INT_OPS.mul, k.int(1n << 40n), k.int(1n << 40n)), (big) =>
    k.call(S.print, k.call(SHOW_ANY, k.call(lib("together"), k.list(...Array.from({ length: n }, (_, i) => k.thunk(() => action(k, i, big, work(k, k.int(i + 1), big))))))))));
}

// The program checked, run by the evaluator and built as C with threads;
// `run` gives what it printed, or its abort, and how many items or
// actions ran on other threads.
function built(marker: RegExp, arrays: boolean, body: (k: Lang) => Id) {
  const k = new Lang(LIBRARY.code), main = k.def("main");
  k.define(main, k.thunk(() => body(k)));
  const code0 = base(k.code), names0 = baseNames(k.names), info0 = infer(code0, names0, undefined, checkOptions);
  assert.deepEqual(info0.errors.map((e) => e.message), []);
  // The list as an array (C30): the map is the array's.
  const r = arrays ? withLibraryRepresentations(code0, info0, names0, main, [main]) : null;
  if (r) assert.deepEqual(r.chosen, ["List as array of List"]);
  const code = r?.code ?? code0, names = r?.names ?? names0, info = r ? infer(code, names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...r.insiders] }) : info0;
  let evaluator = "";
  try { runMain(code, info, main, { print: (l) => { evaluator += `${l}\n`; }, names }); } catch (e) { evaluator = `aborted ${(e as { reason?: unknown }).reason}`; }
  const l = lowerScalar(code, info, names, [main], { data: true, releases: true, handlers: true, threads: true });
  assert.deepEqual([...l.refused.values()], []);
  const c = emitC(l, { main }).c;
  assert.match(c, marker);
  const exe = compile(c);
  const run = (workers: string) => {
    const r = spawnSync(exe, [], { env: { ...process.env, TERS_WORKERS: workers, TERS_BRANCHES: "say" } });
    const err = r.stderr.toString();
    return { out: r.status ? `aborted ${err.split("\n").filter((x) => x && !x.startsWith("items on threads"))[0]}` : r.stdout.toString(), threads: Number(/items on threads: (\d+)/.exec(err)?.[1] ?? 0) };
  };
  return { evaluator, run };
}

test("a map's items run on threads, sharing a big Int and a list, and give the evaluator's array (L101)", { skip }, () => {
  const p = program(12, (k, x, big, list, work) => k.call(INT_OPS.add, k.call(INT_OPS.add, work, k.call(lib("sum"), list)), x));
  assert.match(p.evaluator, /^\d+\n\[/);
  const many = p.run("3"), one = p.run("0");
  assert.equal(many.out, p.evaluator);
  assert.equal(one.out, p.evaluator);
  assert.ok(many.threads > 0, "no item ran on another thread");
  assert.equal(one.threads, 0);
});

// Items 0 to 3 abort, on other threads, after the last ones have
// started them: the map's abort is item 3's, which in order is met first.
test("a map whose items abort on other threads aborts as in order: at the last item that does (L101)", { skip }, () => {
  const p = program(12, (k, x, _big, _list, work) => k.if(k.call(INT_OPS.less, k.call(INT_OPS.add, k.call(INT_OPS.mul, work, k.int(0)), x), k.int(4)), k.call(ABORT_OP, k.call(SHOW_ANY, x)), x));
  assert.equal(p.evaluator, "aborted 3");
  const many = p.run("3");
  assert.equal(many.out, p.evaluator);
  assert.ok(many.threads > 0, "no item ran on another thread");
  assert.equal(p.run("0").out, p.evaluator);
});

// Even items pass, worked out with the work: the keep's array is the
// evaluator's, the items that passed in order.
test("a keep's tests run on threads, and it gives the evaluator's array of the items that passed (C202)", { skip }, () => {
  const even = (k: Lang, x: Id, work: Id) => k.call(S.equal, k.call(INT_OPS.bitAnd, k.call(INT_OPS.add, k.call(INT_OPS.mul, work, k.int(0)), x), k.int(1)), k.int(0));
  const p = program(13, (k, x, _big, _list, work) => even(k, x, work), "keep");
  assert.equal(p.evaluator, "2\n[0, 2, 4, 6, 8, 10, 12]\n");
  const many = p.run("3");
  assert.equal(many.out, p.evaluator);
  assert.ok(many.threads > 0, "no item ran on another thread");
  assert.equal(p.run("0").out, p.evaluator);
  // The library's keep tests its items from the first: one whose tests
  // abort on threads aborts at the first item that does, as in order.
  const aborts = program(12, (k, x, _big, _list, work) => k.if(k.call(INT_OPS.less, x, k.int(4)), k.call(ABORT_OP, k.call(SHOW_ANY, x)), even(k, x, work)), "keep");
  assert.equal(aborts.evaluator, "aborted 0");
  assert.equal(aborts.run("3").out, aborts.evaluator);
  assert.equal(aborts.run("0").out, aborts.evaluator);
});

// main prints all pass's or any pass's answer over 0 to n - 1, a list kept
// as an array (read by position too), with `test` given each and work.
function tested(n: number, by: "all pass" | "any pass" | "first where", test: (k: Lang, x: Id, work: Id) => Id) {
  return built(/lab_par_map_0\(/, true, (k) => k.let("big", k.call(INT_OPS.mul, k.int(1n << 40n), k.int(1n << 40n)), (big) =>
    k.let("xs", k.call(INT_OPS.range, k.int(n)), (xs) =>
      k.seq(k.call(S.print, k.call(SHOW_ANY, k.call(L("item at"), xs, k.int(1), k.int(-1)))),
        k.call(S.print, k.call(SHOW_ANY, k.call(lib(by), xs, k.fn(["x"], (x) => test(k, x, work(k, x, big))))))))));
}

// The first test that decides is the answer, and an abort before it the
// abort; one past it never counts, as in order, where it isn't run.
test("all pass, any pass and first where run their tests on threads, answering by the first that decides, as in order (C202)", { skip }, () => {
  const below = (k: Lang, x: Id, work: Id, m: number) => k.call(INT_OPS.less, k.call(INT_OPS.add, k.call(INT_OPS.mul, work, k.int(0)), x), k.int(m));
  const cases: [string, ReturnType<typeof tested>][] = [
    ["1\nfalse\n", tested(12, "all pass", (k, x, work) => k.if(k.call(INT_OPS.less, k.int(8), x), k.call(ABORT_OP, k.call(SHOW_ANY, x)), below(k, x, work, 7)))],
    ["1\ntrue\n", tested(12, "all pass", (k, x, work) => below(k, x, work, 100))],
    ["1\ntrue\n", tested(12, "any pass", (k, x, work) => k.if(k.call(INT_OPS.less, k.int(8), x), k.call(ABORT_OP, k.call(SHOW_ANY, x)), k.call(S.not, below(k, x, work, 5))))],
    ["aborted 3", tested(12, "any pass", (k, x, work) => k.if(k.call(S.equal, x, k.int(3)), k.call(ABORT_OP, k.call(SHOW_ANY, x)), k.call(S.not, below(k, x, work, 7))))],
    // first where (C202c): the first item that passes.
    ["1\nsome(7)\n", tested(12, "first where", (k, x, work) => k.if(k.call(INT_OPS.less, k.int(8), x), k.call(ABORT_OP, k.call(SHOW_ANY, x)), k.call(S.not, below(k, x, work, 7))))],
    ["1\nnone\n", tested(12, "first where", (k, x, work) => k.call(S.not, below(k, x, work, 100)))],
    ["aborted 3", tested(12, "first where", (k, x, work) => k.if(k.call(S.equal, x, k.int(3)), k.call(ABORT_OP, k.call(SHOW_ANY, x)), k.call(S.not, below(k, x, work, 7))))],
  ];
  for (const [want, p] of cases) {
    assert.equal(p.evaluator, want);
    const many = p.run("3");
    assert.equal(many.out, want);
    assert.ok(many.threads > 0, "no item ran on another thread");
    assert.equal(p.run("0").out, want);
  }
});

// main prints a fold over 0 to n - 1, kept as an array: from z, each
// item's Int (`each`, given the work) put to the rest's by `by`.
function folded(n: number, z: number, by: "add" | "max", each: (k: Lang, x: Id, work: Id) => Id) {
  return built(/lab_par_map_0\(/, true, (k) => k.let("big", k.call(INT_OPS.mul, k.int(1n << 40n), k.int(1n << 40n)), (big) =>
    k.let("xs", k.call(INT_OPS.range, k.int(n)), (xs) =>
      k.seq(k.call(S.print, k.call(SHOW_ANY, k.call(L("item at"), xs, k.int(1), k.int(-1)))),
        k.call(S.print, k.call(SHOW_ANY, k.fold(xs, [
          { variant: NIL, names: [], body: () => k.int(z) },
          { variant: CONS, names: ["x", "rest"], results: [null, "the rest's"], body: ([x], [, r]) => by === "add" ? k.call(INT_OPS.add, each(k, x, work(k, x, big)), r!) : k.let("v", each(k, x, work(k, x, big)), (v) => k.if(k.call(INT_OPS.less, r!, v), v, r!)) },
        ])))))));
}

// A fold adding Ints, or keeping the largest, on threads (C202d): the
// evaluator's Int, big ones too, and the abort the fold in turn meets
// first, the last item's.
test("a fold of an array adding its items' Ints or keeping the largest runs on threads, as in order (C202)", { skip }, () => {
  const plain = (k: Lang, x: Id, work: Id) => k.call(INT_OPS.add, k.call(INT_OPS.mul, k.call(INT_OPS.sub, work, work), k.int(0)), x);
  const cases: [string, ReturnType<typeof folded>][] = [
    ["1\n76\n", folded(12, 10, "add", plain)],
    ["1\n11\n", folded(12, -5, "max", plain)],
    ["1\n40\n", folded(12, 40, "max", plain)],
    ["1\n13298184015760920921767936\n", folded(12, 0, "max", (k, x, work) => k.call(INT_OPS.add, k.call(INT_OPS.mul, work, k.int(0)), k.call(INT_OPS.mul, k.int(1n << 40n), k.call(INT_OPS.mul, k.int(1n << 40n), x))))],
    ["aborted 11", folded(12, 0, "add", (k, x, work) => k.if(k.call(INT_OPS.less, k.int(8), x), k.call(ABORT_OP, k.call(SHOW_ANY, x)), plain(k, x, work)))],
  ];
  for (const [want, p] of cases) {
    assert.equal(p.evaluator, want);
    const many = p.run("3");
    assert.equal(many.out, want);
    // The last item aborts first, here, before any is shared.
    if (!want.startsWith("aborted")) assert.ok(many.threads > 0, "no item ran on another thread");
    assert.equal(p.run("0").out, want);
  }
});

test("a together's actions run on threads, sharing a big Int, and give the evaluator's list (C201)", { skip }, () => {
  const p = togetherProgram(6, (k, i, big, w) => k.call(INT_OPS.add, w, k.call(INT_OPS.mul, big, k.int(i))));
  assert.match(p.evaluator, /^\[\d+, /);
  const many = p.run("3"), one = p.run("0");
  assert.equal(many.out, p.evaluator);
  assert.equal(one.out, p.evaluator);
  assert.ok(many.threads > 0, "no action ran on another thread");
});

// Actions 2 and 4 abort: the together's abort is action 2's, the first in
// order, whichever thread finishes first.
test("a together whose actions abort on threads aborts at the first that does, as in order (C201)", { skip }, () => {
  const p = togetherProgram(6, (k, i, _big, w) => (i === 2 || i === 4 ? k.if(k.call(INT_OPS.less, k.int(0), w), k.call(ABORT_OP, k.lit(`action ${i}`)), w) : w));
  assert.equal(p.evaluator, "aborted action 2");
  const many = p.run("3");
  assert.equal(many.out, p.evaluator);
  assert.ok(many.threads > 0, "no action ran on another thread");
  assert.equal(p.run("0").out, p.evaluator);
});

// main prints the count of a search over 0 to 7 for x, and for each a y of
// those below it (an all inside, which keeps all of its own choices), the
// even ones, after the work for x; `x` may abort.
// count, all or first (with -1 the default) of a search.
const searchBy = (k: Lang, by: Id, s: Id) => (by === S.first ? k.call(by, s, k.thunk(() => k.int(-1))) : k.call(by, s));
function searched(abortAt: number, by: Id = S.count, parity = 0) {
  return built(/lab_par_search_0\(/, false, (k) => k.let("big", k.call(INT_OPS.mul, k.int(1n << 40n), k.int(1n << 40n)), (big) =>
    k.call(S.print, k.call(SHOW_ANY, searchBy(k, by, k.thunk(() =>
      k.let("x", k.call(S.oneOf, k.call(INT_OPS.range, k.int(8))), (x) =>
        k.let("w", k.call(INT_OPS.mul, k.call(INT_OPS.add, work(k, x, big), work(k, x, big)), k.int(0)), (w) =>
          k.if(k.call(S.equal, x, k.int(abortAt)), k.call(ABORT_OP, k.call(SHOW_ANY, x)),
            k.let("ys", k.call(S.all, k.thunk(() => k.call(S.oneOf, k.call(INT_OPS.range, x)))), (ys) =>
              k.let("y", k.call(INT_OPS.add, k.call(S.oneOf, ys), w), (y) =>
                k.if(k.call(S.equal, k.call(INT_OPS.bitAnd, y, k.int(1)), k.int(parity)), y, k.call(S.fail)))))))))))));
}

// A count of a search split by its first choice on threads (C203): the
// evaluator's count, and the abort it meets first in order.
test("a count, an all or a first of a search runs its first choice's items on threads and gives the evaluator's answer, as in order (C203)", { skip }, () => {
  // An all's answers (C203b), in order.
  const all = "[0, 0, 0, 2, 0, 2, 0, 2, 4, 0, 2, 4, 0, 2, 4, 6]\n";
  for (const [want, p] of [["16\n", searched(-1)], ["aborted 3", searched(3)], [all, searched(-1, S.all)], ["aborted 5", searched(5, S.all)], ["0\n", searched(-1, S.first)], ["aborted 1", searched(1, S.first)], ["-1\n", searched(-1, S.first, 2)]] as const) {
    assert.equal(p.evaluator, want);
    const many = p.run("3");
    assert.equal(many.out, want);
    if (!want.startsWith("aborted")) assert.ok(many.threads > 0, "no item ran on another thread");
    assert.equal(p.run("0").out, want);
  }
});

// A search whose first choice has one item (C43 deeper splits): the
// second choice's items run on threads, the answers in order, and an abort
// the first in order's.
function twoDeep(abortAt: number, by: Id = S.count) {
  return built(/lab_par_search_0\(/, false, (k) => k.let("big", k.call(INT_OPS.mul, k.int(1n << 40n), k.int(1n << 40n)), (big) =>
    k.call(S.print, k.call(SHOW_ANY, searchBy(k, by, k.thunk(() =>
      k.let("x", k.call(S.oneOf, k.call(INT_OPS.range, k.int(1))), (x) =>
        k.let("y", k.call(S.oneOf, k.call(INT_OPS.range, k.int(8))), (y) =>
          k.let("w", k.call(INT_OPS.mul, k.call(INT_OPS.add, work(k, y, big), work(k, y, big)), k.int(0)), (w) =>
            k.if(k.call(S.equal, y, k.int(abortAt)), k.call(ABORT_OP, k.call(SHOW_ANY, y)),
              k.call(INT_OPS.add, k.call(INT_OPS.add, x, y), w)))))))))));
}

test("a search whose first choice has one item runs its second choice's items on threads, as in order (C43 deeper splits)", { skip }, () => {
  for (const [want, p] of [["8\n", twoDeep(-1)], ["aborted 4", twoDeep(4)], ["[0, 1, 2, 3, 4, 5, 6, 7]\n", twoDeep(-1, S.all)], ["aborted 6", twoDeep(6, S.all)]] as const) {
    assert.equal(p.evaluator, want);
    const many = p.run("3");
    assert.equal(many.out, want);
    if (!want.startsWith("aborted")) assert.ok(many.threads > 0, "no item ran on another thread");
    assert.equal(p.run("0").out, want);
  }
});
