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
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { ABORT_OP, CONS, INT_OPS, NIL, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { B } from "../../ters/src/prelude.ts";
import { INT } from "../../ters/src/lang/types.ts";
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

// A map of Float64s: its items hold no counts, so none is marked shared
// (it was `undefined_share`, which didn't link: a search's map of
// queens' columns).
test("a map of an array of Float64s runs on threads, the evaluator's array", { skip }, () => {
  const p = built(/lab_par_map_\d\(/, true, (k) => k.let("xs", k.call(lib("map"), k.call(INT_OPS.range, k.int(12)), k.fn(["i"], (i) => k.call(INT_OPS.toNumber, i))), (xs) =>
    k.let("ys", k.call(lib("map"), xs, k.fn(["x"], (x) => k.call(B.add, x, k.call(INT_OPS.toNumber, work(k, k.int(3), k.int(1)))))), (ys) =>
      k.seq(k.call(S.print, k.call(SHOW_ANY, k.call(L("item at"), ys, k.int(1), k.lit(-1)))), k.call(S.print, k.call(SHOW_ANY, ys))))));
  assert.match(p.evaluator, /^\d+\n\[/);
  assert.equal(p.run("3").out, p.evaluator);
  assert.equal(p.run("0").out, p.evaluator);
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

// collatz natively (C42d): `walks of`'s fold, a record of the steps added
// and the most kept, runs its items on threads and gives what the
// evaluator prints.
test("collatz's fold of a record of Ints runs on threads natively and prints the evaluator's (C42d)", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "c-walks-")), ters = join(import.meta.dirname, "../../ters/cli/ters.ts"), at = join(import.meta.dirname, "../../ters/examples/collatz");
  const built = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "native", at, "-o", join(dir, "collatz")]);
  assert.equal(built.status, 0, built.stderr.toString());
  assert.match(readFileSync(join(dir, "collatz.c"), "utf8"), /lab_par_map_\d+\(lab_cell \*xs, lab_cell \*f, Walks z, lab_cell \*jf\)/);
  const evaluator = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "run", at, "3000", "100"]).stdout.toString();
  const runs = (args: string[], workers: string) => spawnSync(join(dir, "collatz"), args, { env: { ...process.env, TERS_WORKERS: workers, TERS_BRANCHES: "say" } });
  for (const workers of ["3", "0"]) assert.equal(runs(["3000", "100"], workers).stdout.toString(), evaluator, `${workers} workers`);
  // Big enough to be worth the threads: the same as on one.
  const many = runs(["300000", "300"], "3");
  assert.match(many.stderr.toString(), /items on threads: [1-9]/);
  assert.equal(many.stdout.toString(), runs(["300000", "300"], "0").stdout.toString());
});

// fingerprint natively (C42e): its numbers' walks a map of an array,
// shared on the threads, and the hash put together in turn.
test("fingerprint's walks run on threads natively and it prints the evaluator's (C42e)", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "c-fingerprint-")), ters = join(import.meta.dirname, "../../ters/cli/ters.ts"), at = join(import.meta.dirname, "../../ters/examples/fingerprint");
  const built = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "native", at, "-o", join(dir, "fingerprint")]);
  assert.equal(built.status, 0, built.stderr.toString());
  const evaluator = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "run", at, "12", "--evaluator"]).stdout.toString();
  const runs = (args: string[], workers: string) => spawnSync(join(dir, "fingerprint"), args, { env: { ...process.env, TERS_WORKERS: workers, TERS_BRANCHES: "say" } });
  for (const workers of ["3", "0"]) assert.equal(runs(["12"], workers).stdout.toString(), evaluator, `${workers} workers`);
  const many = runs(["400"], "3");
  assert.match(many.stderr.toString(), /items on threads: [1-9]/);
  assert.equal(many.stdout.toString(), runs(["400"], "0").stdout.toString());
});

// divisors natively (C207b, C207c): `array of` a range is the array filled
// at once, no list made; the sum of a map is one fold, no mapped array
// made (fuse-steps.ts); and the answer is the evaluator's.
test("divisors natively fills `array of` a range straight away, sums its map in one fold, and prints the evaluator's (C207b to C207d)", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "c-range-")), ters = join(import.meta.dirname, "../../ters/cli/ters.ts"), at = join(import.meta.dirname, "../../ters/examples/divisors");
  const built = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "native", at, "-o", join(dir, "divisors")]);
  assert.equal(built.status, 0, built.stderr.toString());
  const c = readFileSync(join(dir, "divisors.c"), "utf8");
  assert.match(c, /lab_array_range_a\d+\(/);
  assert.doesNotMatch(c, /lab_int_range\(/);
  assert.doesNotMatch(c, /lab_array_map\(/);
  // C207d: its fold over the range counts down, no array filled.
  assert.match(c, /double lab_divisors_at_Float64_fold_items\(lab_int p0, lab_int p1/);
  const evaluator = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "run", at, "300", "40"]).stdout.toString();
  assert.match(evaluator, /some\(/);
  for (const workers of ["3", "0"]) assert.equal(spawnSync(join(dir, "divisors"), ["300", "40"], { env: { ...process.env, TERS_WORKERS: workers } }).stdout.toString(), evaluator, `${workers} workers`);
});

test("fibonacci's two calls of itself run on threads natively, the evaluator's number (C61e3)", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "c-both-")), ters = join(import.meta.dirname, "../../ters/cli/ters.ts"), at = join(import.meta.dirname, "../../ters/examples/fibonacci");
  const made = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "native", at, "-o", join(dir, "fibonacci")]);
  assert.equal(made.status, 0, made.stderr.toString());
  assert.match(readFileSync(join(dir, "fibonacci.c"), "utf8"), /lab_both_\d+\(/);
  const evaluator = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "run", at, "15"]).stdout.toString();
  assert.equal(evaluator, "610\n");
  for (const workers of ["3", "0"]) assert.equal(spawnSync(join(dir, "fibonacci"), ["15"], { env: { ...process.env, TERS_WORKERS: workers } }).stdout.toString(), evaluator, `${workers} workers`);
  const side = spawnSync(join(dir, "fibonacci"), ["32"], { env: { ...process.env, TERS_WORKERS: "3", TERS_BRANCHES: "say" } });
  assert.equal(side.stdout.toString(), "2178309\n");
  assert.ok(Number(/items on threads: (\d+)/.exec(side.stderr.toString())?.[1]) > 0, side.stderr.toString());
});

// main prints the total of a tree of 16 leaves, 16 to 31, each summing
// 20000 products; leaves `aborts` abort instead.
function treeProgram(aborts: number[] = []) {
  return built(/lab_both_\d+\(/, false, (k) => {
    const Tree = k.type("Tree", [], [["leaf", [["n", () => k.tref(INT)]]], ["node", [["left", (self) => k.tref(self)], ["right", (self) => k.tref(self)]]]]);
    const grow = k.def("grow"), total = k.def("total");
    k.define(grow, k.fn(["d", "x"], (d, x) => k.if(k.call(INT_OPS.less, d, k.int(1)), k.call(Tree.v.leaf, x),
      k.call(Tree.v.node, k.call(grow, k.call(INT_OPS.sub, d, k.int(1)), k.call(INT_OPS.mul, x, k.int(2))), k.call(grow, k.call(INT_OPS.sub, d, k.int(1)), k.call(INT_OPS.add, k.call(INT_OPS.mul, x, k.int(2)), k.int(1)))))));
    const sum = (n: Id) => k.call(lib("sum"), k.call(lib("map"), k.call(INT_OPS.range, k.int(20000)), k.fn(["i"], (i) => k.call(INT_OPS.mul, i, n))));
    const leaf = (n: Id) => aborts.reduce<Id>((e, a) => k.if(k.call(S.equal, n, k.int(a)), k.call(ABORT_OP, k.lit(`leaf ${a}`)), e), sum(n));
    k.define(total, k.fn(["t"], (t) => k.fold(t, [
      { variant: Tree.v.leaf, names: ["n"], body: ([n]) => leaf(n) },
      { variant: Tree.v.node, names: ["l", "r"], results: ["a", "b"], body: (_, [a, b]) => k.call(INT_OPS.add, a!, b!) },
    ])));
    return k.call(S.print, k.call(SHOW_ANY, k.call(total, k.call(grow, k.int(4), k.int(1)))));
  });
}

test("a fold over a tree works out its two halves on threads natively, the evaluator's total (C61e3)", { skip }, () => {
  const p = treeProgram();
  assert.match(p.evaluator, /^\d+\n$/);
  const side = p.run("3"), alone = p.run("0");
  assert.equal(side.out, p.evaluator);
  assert.equal(alone.out, p.evaluator);
  assert.ok(side.threads > 0, `${side.threads} on threads`);
});

test("a fold over a tree whose leaves abort on threads aborts at the first in order (C61e3)", { skip }, () => {
  const p = treeProgram([27, 20]);
  assert.equal(p.evaluator, "aborted leaf 20");
  assert.equal(p.run("3").out, p.evaluator);
  assert.equal(p.run("0").out, p.evaluator);
});

// queens-count natively (C207f): `safe`'s fold to a function of the
// distance, applied at once, is a loop from the first queen placed, no
// closure per queen, and the count is the evaluator's.
test("queens-count natively checks a column by a loop over the queens placed, and counts the evaluator's boards (C207f, C207n, C207p, C207r)", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "c-forward-")), ters = join(import.meta.dirname, "../../ters/cli/ters.ts"), at = join(import.meta.dirname, "../../ters/examples/queens-count");
  const built = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "native", at, "-o", join(dir, "queens")]);
  assert.equal(built.status, 0, built.stderr.toString());
  const c = readFileSync(join(dir, "queens.c"), "utf8");
  assert.match(c, /lab_safe_fold_forward\(/);
  assert.doesNotMatch(c, /lab_safe_fold_items\(/);
  // C207n: its search runs on the threads (`par:count:search`), and still
  // its columns are known finite and the loop gives false once it is.
  const loop = /\nint32_t lab_safe_fold_forward_finite_counted_b\([^)]*\) \{[\s\S]*?\n\}\n/.exec(c);
  assert.ok(loop, "the counted loop");
  assert.doesNotMatch(loop[0], /lab_stop/);
  assert.match(loop[0], /\} else \{[^{}]*return 0;/);
  // C207p: its choice of a column counts through the range, no list made.
  assert.match(c, /lab__i64_range_split\(/);
  const place = /\nint32_t lab_queens_fold_items(?:_b)?\([^)]*\) \{[\s\S]*?\n\}\n/.exec(c);
  assert.ok(place, "the placement");
  assert.doesNotMatch(place[0], /lab_array_items_a\d+\(/);
  // C207r: the placed columns lent to `safe` and its loop, not counted.
  assert.match(c, /= lab_safe_b\(l\d+, p\d+\);/);
  assert.doesNotMatch(loop[0], /lab_drop\(p0\)/);
  const evaluator = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "run", at, "6"]).stdout.toString();
  assert.match(evaluator, /boards of 6 queens: 4/);
  for (const workers of ["3", "0"]) for (const n of ["6", "8"]) {
    const out = spawnSync(join(dir, "queens"), [n], { env: { ...process.env, TERS_WORKERS: workers } }).stdout.toString();
    assert.equal(out, n === "6" ? evaluator : "boards of 8 queens: 92\n", `${workers} workers, ${n}`);
  }
});

// queens-first natively (C207h): `safe`'s loop checks the column and the
// distance on its first step only, its later steps running a copy that
// knows them finite, and the board is the evaluator's.
test("queens-first natively checks a loop's unchanged numbers once, its columns never, and finds the evaluator's board (C207h, C207l, C207m)", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "c-finite-")), ters = join(import.meta.dirname, "../../ters/cli/ters.ts"), at = join(import.meta.dirname, "../../ters/examples/queens-first");
  const built = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "native", at, "-o", join(dir, "queens")]);
  assert.equal(built.status, 0, built.stderr.toString());
  const c = readFileSync(join(dir, "queens.c"), "utf8");
  assert.match(c, /lab_safe_fold_forward_finite\w*\(/);
  // C207l: the columns are finite and not below zero (made by `range`,
  // pushed back as they are), so the loop's steps check neither an item
  // nor its distance from the column.
  const loop = /\nint32_t lab_safe_fold_forward_finite_counted_b\([^)]*\) \{[\s\S]*?\n\}\n/.exec(c);
  assert.ok(loop, "the counted loop");
  assert.doesNotMatch(loop[0], /lab_stop/);
  // C207m: and once its answer is false it gives false there and then.
  assert.match(loop[0], /\} else \{[^{}]*return 0;/);
  const evaluator = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ters, "run", at, "8"]).stdout.toString();
  assert.match(evaluator, /\[3, 1, 6, 2, 5, 7, 4, 0\]/);
  for (const workers of ["3", "0"]) assert.equal(spawnSync(join(dir, "queens"), ["8"], { env: { ...process.env, TERS_WORKERS: workers } }).stdout.toString(), evaluator, `${workers} workers`);
});
