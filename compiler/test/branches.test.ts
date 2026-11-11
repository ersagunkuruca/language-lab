// Pure branches of together on worker threads (C41, branches-rt.ts): a
// compiled module shares a together's branches with workers, and a map's
// or keep's items (C42, C43), and says what it says run in order: the same values, and
// the first abort in the actions' or items' order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { ABORT_OP, CONS, INT_OPS, NIL, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { INT } from "../../ters/src/lang/types.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { B } from "../../ters/src/prelude.ts";
import type { Id } from "../../ters/src/model.ts";
import { coreModule, lowerCore } from "../src/core-js.ts";

const here = import.meta.dirname, ters = join(here, "../../ters/cli/ters.ts");
const run = (args: string[], env: Record<string, string>, cwd?: string): Promise<[string, string, number]> =>
  new Promise((done) => { execFile(process.execPath, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } }, (e, out, err) => done([out, err, e ? Number(e.code ?? 1) : 0])).stdin?.end(); });
const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

// A module of a main written here, unbundled: it imports the runtime from
// this checkout, as `ters compile` without esbuild does.
function module(dir: string, make: (k: Lang) => Id, shares = true): string {
  const k = new Lang(LIBRARY.code), main = make(k);
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lowered = lowerCore(code, info, names, [main]);
  assert.equal(lowered.refused.get(main), undefined);
  const js = coreModule(lowered, "main", join(here, "../src/core-rt.ts"), join(here, "../../ters/src/lang/world.ts"));
  if (shares) assert.match(js, /R\.rt\("(together|map)\.pure"/);
  const file = join(dir, `${names[main]}.mjs`);
  writeFileSync(file, js);
  return file;
}

test("area counts its eight bands on workers, and says what it says in order and in the evaluator (C41)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const [made, inEvaluator] = await Promise.all([run([ters, "compile", join(here, "../../ters/examples/area"), "-o", "area.mjs"], {}, dir), run([ters, "run", join(here, "../../ters/examples/area"), "100"], {})]);
  assert.equal(made[2], 0, made[1]);
  const [side, alone, small] = await Promise.all([run(["area.mjs", "900"], { TERS_BRANCHES: "say", TERS_WORKERS: "3" }, dir), run(["area.mjs", "900"], { TERS_WORKERS: "0" }, dir), run(["area.mjs", "100"], { TERS_BRANCHES: "say" }, dir)]);
  assert.equal(side[0], alone[0]);
  assert.match(side[1], /branches on workers: [1-7]\n/);
  // Bands this small stay on the main thread: starting workers would cost more.
  assert.equal(small[0], inEvaluator[0]);
  assert.equal(small[1], "branches on workers: 0\n");
});

// Each branch long enough to start the workers: a total fold over a
// range, so none may run long (Diverge), and an abort before it may.
const work = (k: Lang, n: number, seed: number) => k.call(lib("sum"), k.call(lib("map"), k.call(INT_OPS.range, k.int(n)), k.fn(["i"], (i) => k.call(B.mul, k.call(INT_OPS.toNumber, i), k.lit(seed)))));

test("values cross back as they were, lists and what the branches captured (C41)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const file = module(dir, (k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.let("scale", k.lit(0.5), (scale) => k.call(S.print, k.call(SHOW_ANY, k.call(lib("together"), k.list(
      ...[1, 2, 3, 4, 5, 6].map((i) => k.thunk(() => k.list(work(k, 1500000, i), k.call(B.mul, scale, k.lit(i)), k.lit(i)))),
    )))))));
    return main;
  });
  const [many, one] = await Promise.all([run([file], { TERS_BRANCHES: "say", TERS_WORKERS: "2" }), run([file], { TERS_WORKERS: "0" })]);
  assert.equal(many[2], 0, many[1]);
  assert.equal(many[0], one[0]);
  assert.match(many[0], /^\[\[1124999250000, 0\.5, 1\], \[2249998500000, 1, 2\], /);
  // Units on workers: branches, or runs of the maps inside one run before
  // the workers were there (C42).
  assert.match(many[1], /branches on workers: [1-9]\d*\n/);
});

test("the first abort in the actions' order is the together's, wherever each ran (C41)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const file = module(dir, (k) => {
    const main = k.def("main");
    const aborts = (why: string, i: number) => k.thunk(() => k.if(k.call(S.less, work(k, 400000, i), k.lit(0)), k.lit(0), k.call(ABORT_OP, k.lit(why))));
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(lib("together"), k.list(aborts("first", 1), aborts("second", 2), k.thunk(() => work(k, 400000, 3))))))));
    return main;
  });
  for (const workers of ["2", "0"]) {
    const [out, err, code] = await run([file], { TERS_WORKERS: workers });
    assert.deepEqual([out, err, code], ["", "first\n", 1], `with ${workers} workers`);
  }
});

test("mandelbrot-rows draws its rows by one map on workers, the same picture in order and in the evaluator (C42)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const [made, inEvaluator] = await Promise.all([run([ters, "compile", join(here, "../../ters/examples/mandelbrot-rows"), "-o", "mandelbrot-rows.mjs"], {}, dir), run([ters, "run", join(here, "../../ters/examples/mandelbrot-rows"), "40", "60"], {})]);
  assert.equal(made[2], 0, made[1]);
  const [side, alone, small] = await Promise.all([run(["mandelbrot-rows.mjs", "600", "3000"], { TERS_BRANCHES: "say", TERS_WORKERS: "3" }, dir), run(["mandelbrot-rows.mjs", "600", "3000"], { TERS_WORKERS: "0" }, dir), run(["mandelbrot-rows.mjs", "40", "60"], { TERS_BRANCHES: "say" }, dir)]);
  assert.equal(side[0], alone[0]);
  assert.match(side[1], /branches on workers: [1-9]\d*\n/);
  assert.equal(small[0], inEvaluator[0]);
  assert.equal(small[1], "branches on workers: 0\n");
});

test("a map's items cross with what its function captured, and its first abort is the item order's (C42)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const file = module(dir, (k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.let("scale", k.lit(0.5), (scale) => k.call(S.print, k.call(SHOW_ANY, k.call(lib("map"), k.call(INT_OPS.range, k.int(12)),
      k.fn(["i"], (i) => k.list(work(k, 600000, 1), k.call(B.mul, scale, k.call(INT_OPS.toNumber, i))))))))));
    return main;
  });
  const [many, one] = await Promise.all([run([file], { TERS_BRANCHES: "say", TERS_WORKERS: "2" }), run([file], { TERS_WORKERS: "0" })]);
  assert.equal(many[2], 0, many[1]);
  assert.equal(many[0], one[0]);
  assert.match(many[0], /^\[\[179999700000, 0\], \[179999700000, 0\.5\], /);
  assert.match(many[1], /branches on workers: [1-9]\d*\n/);
  const aborts = module(mkdtempSync(join(tmpdir(), "branches-")), (k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(lib("map"), k.call(INT_OPS.range, k.int(8)),
      k.fn(["i"], (i) => k.if(k.call(S.less, k.call(B.add, work(k, 400000, 1), k.call(INT_OPS.toNumber, i)), k.lit(79999800005)), k.lit(0), k.call(ABORT_OP, k.call(SHOW_ANY, i)))))))));
    return main;
  });
  for (const workers of ["2", "0"]) {
    const [out, err, code] = await run([aborts], { TERS_WORKERS: workers });
    assert.deepEqual([out, err, code], ["", "5\n", 1], `with ${workers} workers`);
  }
});

test("a fold adding an Int for each item adds them on workers, and its first abort is the one the fold in turn meets first, the last item's (C42)", async () => {
  // Item i's Int is 1, worked out by a sum, or an abort for i of 5 or more.
  const file = module(mkdtempSync(join(tmpdir(), "branches-")), (k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.fold(k.call(INT_OPS.range, k.int(8)), [
      { variant: NIL, names: [], body: () => k.int(10) },
      { variant: CONS, names: ["i", "rest"], results: [null, "the rest's"], body: ([i], [, r]) => k.call(INT_OPS.add,
        k.if(k.call(S.less, k.call(B.add, work(k, 400000, 1), k.call(INT_OPS.toNumber, i)), k.lit(79999800005)), k.int(1), k.call(ABORT_OP, k.call(SHOW_ANY, i))), r!) },
    ])))));
    return main;
  }, false);
  assert.match(readFileSync(file, "utf8"), /R\.rt\("fold\.pure"/);
  for (const workers of ["2", "0"]) {
    const [out, err, code] = await run([file], { TERS_WORKERS: workers });
    assert.deepEqual([out, err, code], ["", "7\n", 1], `with ${workers} workers`);
  }
});

test("a fold keeping its items' smallest Int keeps it on workers, or the empty list's when smaller (C42)", async () => {
  // Item i's Int is 3000100 less i · 7, worked out by 3000000 steps (so the
  // last is the smallest), or the empty list's when it is smaller still.
  const file = module(mkdtempSync(join(tmpdir(), "branches-")), (k) => {
    const main = k.def("main"), down = k.def("down");
    // n again, by n steps.
    k.define(down, k.fn(["n", "got"], (n, got) => k.if(k.call(INT_OPS.less, k.int(0), n), k.call(down, k.call(INT_OPS.sub, n, k.int(1)), k.call(INT_OPS.add, got, k.int(1))), got)));
    const least = (z: number) => k.fold(k.call(INT_OPS.range, k.int(12)), [
      { variant: NIL, names: [], body: () => k.int(z) },
      { variant: CONS, names: ["i", "rest"], results: [null, "the rest's"], body: ([i], [, r]) => k.let("v", k.call(INT_OPS.sub, k.call(INT_OPS.add, k.int(100), k.call(down, k.int(3000000), k.int(0))), k.call(INT_OPS.mul, i, k.int(7))),
        (v) => k.if(k.call(INT_OPS.less, v, r!), v, r!)) },
    ]);
    k.define(main, k.thunk(() => k.call(S.print, k.text(k.call(SHOW_ANY, least(10000000)), k.lit(" "), k.call(SHOW_ANY, least(5))))));
    return main;
  }, false);
  assert.match(readFileSync(file, "utf8"), /"min"/);
  for (const workers of ["2", "0"]) {
    const [out, err, code] = await run([file], { TERS_WORKERS: workers });
    assert.deepEqual([out, err, code], ["3000023 5\n", "", 0], `with ${workers} workers`);
  }
});

// A fold whose join is no sum (C42e): each number's walks worked out on
// workers as a map's items, the hashes then put together in turn.
test("fingerprint works out its numbers' walks on workers and hashes them in turn, the same as in turn and in the evaluator (C42e)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const [made, inEvaluator] = await Promise.all([run([ters, "compile", join(here, "../../ters/examples/fingerprint"), "-o", "fingerprint.mjs"], {}, dir), run([ters, "run", join(here, "../../ters/examples/fingerprint"), "12", "--evaluator"], {})]);
  assert.equal(made[2], 0, made[1]);
  assert.match(readFileSync(join(dir, "fingerprint.mjs"), "utf8"), /R\d*\.rt\("map\.pure"/);
  const [side, alone, small] = await Promise.all([run(["fingerprint.mjs", "400"], { TERS_BRANCHES: "say", TERS_WORKERS: "3" }, dir), run(["fingerprint.mjs", "400"], { TERS_WORKERS: "0" }, dir), run(["fingerprint.mjs", "12"], {}, dir)]);
  assert.equal(side[0], alone[0]);
  assert.match(side[0], /below 400: \d+\n$/);
  assert.match(side[1], /branches on workers: [1-9]\d*\n/);
  assert.equal(small[0], inEvaluator[0]);
});

test("collatz keeps its long walks on workers, the same numbers in the same order as in turn and in the evaluator (C43)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const [made, inEvaluator] = await Promise.all([run([ters, "compile", join(here, "../../ters/examples/collatz"), "-o", "collatz.mjs"], {}, dir), run([ters, "run", join(here, "../../ters/examples/collatz"), "2000", "100"], {})]);
  assert.equal(made[2], 0, made[1]);
  // keep is copied by the arrays pass (library-reps.ts), and known by its copy's id.
  assert.match(readFileSync(join(dir, "collatz.mjs"), "utf8"), /R\d*\.rt\("keep\.pure"/);
  // And `walks of`'s fold, a record adding each number's steps and keeping
  // the largest, shared out and put together by its own join (C42d).
  assert.match(readFileSync(join(dir, "collatz.mjs"), "utf8"), /R\d*\.rt\("fold\.pure"/);
  assert.match(readFileSync(join(dir, "collatz.mjs"), "utf8"), /, "with", (fuel|Infinity), /);
  const [side, alone, small] = await Promise.all([run(["collatz.mjs", "300000", "300"], { TERS_BRANCHES: "say", TERS_WORKERS: "3" }, dir), run(["collatz.mjs", "300000", "300"], { TERS_WORKERS: "0" }, dir), run(["collatz.mjs", "2000", "100"], {}, dir)]);
  assert.equal(side[0], alone[0]);
  assert.match(side[0], /^665 numbers below 300000 take more than 300 steps/);
  assert.match(side[1], /branches on workers: [1-9]\d*\n/);
  assert.equal(small[0], inEvaluator[0]);
});

test("nicomachus checks its ks by all pass and any pass on workers, the same answers as in turn and in the evaluator (C43)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const [made, inEvaluator] = await Promise.all([run([ters, "compile", join(here, "../../ters/examples/nicomachus"), "-o", "nicomachus.mjs"], {}, dir), run([ters, "run", join(here, "../../ters/examples/nicomachus"), "200"], {})]);
  assert.equal(made[2], 0, made[1]);
  const [side, alone, small] = await Promise.all([run(["nicomachus.mjs", "10000"], { TERS_BRANCHES: "say", TERS_WORKERS: "3" }, dir), run(["nicomachus.mjs", "10000"], { TERS_WORKERS: "0" }, dir), run(["nicomachus.mjs", "200"], {}, dir)]);
  assert.equal(side[0], alone[0]);
  assert.match(side[0], /for every k below 10000: true; some sum of cubes past 10¹²: true/);
  assert.match(side[1], /branches on workers: [1-9]\d*\n/);
  assert.equal(small[0], inEvaluator[0]);
});

test("divisors finds its n by first where on workers, the same answer as in turn and in the evaluator (C43)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const [made, inEvaluator] = await Promise.all([run([ters, "compile", join(here, "../../ters/examples/divisors"), "-o", "divisors.mjs"], {}, dir), run([ters, "run", join(here, "../../ters/examples/divisors"), "1000", "100"], {})]);
  assert.equal(made[2], 0, made[1]);
  assert.match(readFileSync(join(dir, "divisors.mjs"), "utf8"), /R\d*\.rt\("first\.pure"/);
  const [side, alone, none, small] = await Promise.all([run(["divisors.mjs", "10000", "400"], { TERS_BRANCHES: "say", TERS_WORKERS: "3" }, dir), run(["divisors.mjs", "10000", "400"], { TERS_WORKERS: "0" }, dir), run(["divisors.mjs", "1500", "2000"], { TERS_WORKERS: "3" }, dir), run(["divisors.mjs", "1000", "100"], {}, dir)]);
  assert.equal(side[0], alone[0]);
  assert.match(side[0], /more than 400 divisors: some\(5984\)/);
  assert.match(side[1], /branches on workers: [1-9]\d*\n/);
  assert.match(none[0], /more than 2000 divisors: none/);
  assert.equal(small[0], inEvaluator[0]);
});

test("queens-count counts its boards by the first row's columns on workers, the same count as in turn and in the evaluator (C43, C207s)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const [made, inEvaluator] = await Promise.all([run([ters, "compile", join(here, "../../ters/examples/queens-count"), "-o", "queens-count.mjs"], {}, dir), run([ters, "run", join(here, "../../ters/examples/queens-count"), "6"], {})]);
  assert.equal(made[2], 0, made[1]);
  const js = readFileSync(join(dir, "queens-count.mjs"), "utf8");
  assert.match(js, /R\d*\.rt\("count\.search"/);
  // C207s: its choice of a column counts through the range, split on the
  // workers too (and fast enough now that 10 queens stay in turn).
  assert.match(js, /R\d*\.rt\("range\.split"\)/);
  const [side, alone, small] = await Promise.all([run(["queens-count.mjs", "11"], { TERS_BRANCHES: "say", TERS_WORKERS: "3" }, dir), run(["queens-count.mjs", "11"], { TERS_WORKERS: "0" }, dir), run(["queens-count.mjs", "6"], {}, dir)]);
  assert.equal(side[0], alone[0]);
  assert.match(side[0], /boards of 11 queens: 2680\n/);
  assert.match(side[1], /branches on workers: [1-9]\d*\n/);
  assert.equal(small[0], inEvaluator[0]);
});

// A search inside the one a count splits keeps every item of its own
// choices, wherever it runs (C43).
test("a count split by its first choice counts a search inside it whole (C43)", async () => {
  const file = module(mkdtempSync(join(tmpdir(), "branches-")), (k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(S.count, k.thunk(() =>
      k.let("x", k.call(S.oneOf, k.call(INT_OPS.range, k.int(8))), (x) =>
        k.let("ys", k.call(S.all, k.thunk(() => k.call(S.oneOf, k.call(INT_OPS.range, x)))), (ys) =>
          k.call(B.add, k.call(INT_OPS.toNumber, k.call(S.oneOf, ys)), k.call(B.mul, work(k, 300000, 1), k.lit(0)))))))))));
    return main;
  }, false);
  assert.match(readFileSync(file, "utf8"), /R\.rt\("count\.search"[\s\S]*R\.rt\("all\.search"/);
  const [side, alone] = await Promise.all([run([file], { TERS_WORKERS: "3", TERS_BRANCHES: "say" }), run([file], { TERS_WORKERS: "0" })]);
  assert.deepEqual([side[0], side[2]], ["28\n", 0]);
  assert.match(side[1], /branches on workers: [1-9]\d*\n/);
  assert.deepEqual(alone, ["28\n", "", 0]);
});

// A search whose first choice has one item with answers (x = 1 has
// none) is shared out by its second choice's items too (C43g deeper
// splits), the last piece of each x taking the rest of them: an all's
// answers in order, wherever each ran. (queens-count's README times it.)
test("a search whose first choice has one item with answers shares out its second choice's items, its answers in order (C43g)", async () => {
  const file = module(mkdtempSync(join(tmpdir(), "branches-")), (k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(S.all, k.thunk(() =>
      k.let("x", k.call(S.oneOf, k.call(INT_OPS.range, k.int(2))), (x) =>
        k.let("y", k.call(S.oneOf, k.call(INT_OPS.range, k.call(INT_OPS.mul, k.call(INT_OPS.sub, k.int(1), x), k.int(6)))), (y) =>
          k.let("z", k.call(S.oneOf, k.call(INT_OPS.range, y)), (z) =>
            k.call(B.add, k.call(INT_OPS.toNumber, k.call(INT_OPS.add, k.call(INT_OPS.add, x, k.call(INT_OPS.mul, y, k.int(10))), z)), k.call(B.mul, work(k, 300000, 1), k.lit(0))))))))))));
    return main;
  }, false);
  assert.match(readFileSync(file, "utf8"), /R\.rt\("all\.search"/);
  const want = "[10, 20, 21, 30, 31, 32, 40, 41, 42, 43, 50, 51, 52, 53, 54]\n";
  const [side, alone] = await Promise.all([run([file], { TERS_WORKERS: "3", TERS_BRANCHES: "say" }), run([file], { TERS_WORKERS: "0" })]);
  assert.deepEqual([side[0], side[2]], [want, 0]);
  assert.match(side[1], /branches on workers: [1-9]\d*\n/);
  assert.deepEqual(alone, [want, "", 0]);
});

// A search met before the split choice keeps its own choices whole, and
// the split falls on the choice after it (C43).
test("a count split by its first choice leaves a search before that choice whole (C43)", async () => {
  const file = module(mkdtempSync(join(tmpdir(), "branches-")), (k) => {
    // The first inside may run long (pick recurses), so it is the
    // compiled search here, not shared itself.
    const main = k.def("main"), pick = k.def("pick");
    k.define(pick, k.fn(["n"], (n) => k.if(k.call(INT_OPS.less, n, k.int(3)), k.call(pick, n), k.call(S.oneOf, k.list(k.int(3), k.int(4), k.int(5))))));
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(S.count, k.thunk(() =>
      k.let("z", k.call(S.first, k.thunk(() => k.call(pick, k.int(5))), k.thunk(() => k.int(0))), (z) =>
        k.let("x", k.call(S.oneOf, k.call(INT_OPS.range, k.call(INT_OPS.add, z, k.int(5)))), (x) =>
          k.call(B.add, k.call(INT_OPS.toNumber, x), k.call(B.mul, work(k, 300000, 1), k.lit(0)))))))))));
    return main;
  }, false);
  assert.match(readFileSync(file, "utf8"), /R\.rt\("count\.search"[\s\S]*R\.rt\("split\.hold"/);
  for (const workers of ["3", "0"]) assert.deepEqual((await run([file], { TERS_WORKERS: workers })).slice(0, 1), ["8\n"], `${workers} workers`);
});

// first of a search split by its first choice: the answer under the
// first item that has one, in order, wherever each ran (C43).
test("a first split by its first choice gives the answer under the first item with one, wherever each ran (C43)", async () => {
  const file = module(mkdtempSync(join(tmpdir(), "branches-")), (k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(S.first, k.thunk(() =>
      k.let("x", k.call(S.oneOf, k.call(INT_OPS.range, k.int(12))), (x) =>
        k.let("w", k.call(B.add, k.call(INT_OPS.toNumber, x), k.call(B.mul, work(k, 300000, 1), k.lit(0))), (w) =>
          k.let("y", k.call(S.oneOf, k.list(k.lit(100), k.lit(200))), (y) =>
            k.if(k.call(S.less, w, k.lit(7)), k.call(S.fail), k.call(B.add, w, y)))))), k.thunk(() => k.lit(-1)))))));
    return main;
  }, false);
  assert.match(readFileSync(file, "utf8"), /R\.rt\("first\.search"/);
  for (const workers of ["3", "0"]) assert.deepEqual((await run([file], { TERS_WORKERS: workers })).slice(0, 1), ["107\n"], `${workers} workers`);
});

// A search of one answer or none has no choice to split: count and first
// of it stay the compiled search's (C43).
test("a count and a first of a search of one answer or none stay as compiled (C43)", async () => {
  const file = module(mkdtempSync(join(tmpdir(), "branches-")), (k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.text(
      k.call(SHOW_ANY, k.call(S.count, k.thunk(() => k.call(INT_OPS.read, k.lit("12"))))), k.lit(" "),
      k.call(SHOW_ANY, k.call(S.first, k.thunk(() => k.call(INT_OPS.read, k.lit("x"))), k.thunk(() => k.int(7))))))));
    return main;
  }, false);
  assert.doesNotMatch(readFileSync(file, "utf8"), /\.search"/);
  assert.deepEqual(await run([file], {}), ["1 7\n", "", 0]);
});

// all pass stops at the first item that fails: an abort after it isn't
// seen, one before it is, wherever each ran (C43).
test("all pass's first deciding item or abort in order is its answer, wherever each ran (C43)", async () => {
  const program = (abortAt: number, failAt: number) => module(mkdtempSync(join(tmpdir(), "branches-")), (k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(lib("all pass"), k.call(INT_OPS.range, k.int(12)), k.fn(["i"], (i) =>
      k.let("n", k.call(B.add, k.call(INT_OPS.toNumber, i), k.call(B.mul, work(k, 300000, 1), k.lit(0))), (n) =>
        k.if(k.call(S.equal, n, k.lit(abortAt)), k.call(ABORT_OP, k.lit(`abort at ${abortAt}`)), k.call(S.less, n, k.lit(failAt))))))))));
    return main;
  }, false);
  const [failsFirst, abortsFirst] = [program(9, 4), program(3, 7)];
  for (const workers of ["3", "0"]) {
    assert.deepEqual(await run([failsFirst], { TERS_WORKERS: workers }), ["false\n", "", 0], `fails first, ${workers} workers`);
    assert.deepEqual(await run([abortsFirst], { TERS_WORKERS: workers }), ["", "abort at 3\n", 1], `aborts first, ${workers} workers`);
  }
});

test("fibonacci's two calls of itself are shared out on workers, the same number as in turn and in the evaluator (C61 e)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const [made, inEvaluator] = await Promise.all([run([ters, "compile", join(here, "../../ters/examples/fibonacci"), "-o", "fibonacci.mjs"], {}, dir), run([ters, "run", join(here, "../../ters/examples/fibonacci"), "15"], {})]);
  assert.equal(made[2], 0, made[1]);
  assert.match(readFileSync(join(dir, "fibonacci.mjs"), "utf8"), /R\d*\.rt\("both\.pure"/);
  const [side, alone, small] = await Promise.all([run(["fibonacci.mjs", "36"], { TERS_BRANCHES: "say", TERS_WORKERS: "3" }, dir), run(["fibonacci.mjs", "36"], { TERS_WORKERS: "0" }, dir), run(["fibonacci.mjs", "15"], {}, dir)]);
  assert.equal(side[0], alone[0]);
  assert.equal(side[0], "14930352\n");
  assert.match(side[1], /branches on workers: [1-9]\d*\n/);
  assert.equal(small[0], inEvaluator[0]);
});

// A tree grown by halves (its two halves a function's two calls of itself)
// and folded by halves, each leaf a long sum: both worked out on workers.
test("a fold over a tree works out its two halves on workers, the same total as in turn (C61 e)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branches-"));
  const file = module(dir, (k) => {
    const Tree = k.type("Tree", [], [["leaf", [["n", () => k.tref(INT)]]], ["node", [["left", (self) => k.tref(self)], ["right", (self) => k.tref(self)]]]]);
    const grow = k.def("grow"), total = k.def("total"), main = k.def("main");
    k.define(grow, k.fn(["d", "x"], (d, x) => k.if(k.call(INT_OPS.less, d, k.int(1)), k.call(Tree.v.leaf, x),
      k.call(Tree.v.node, k.call(grow, k.call(INT_OPS.sub, d, k.int(1)), k.call(INT_OPS.mul, x, k.int(2))), k.call(grow, k.call(INT_OPS.sub, d, k.int(1)), k.call(INT_OPS.add, k.call(INT_OPS.mul, x, k.int(2)), k.int(1)))))));
    k.define(total, k.fn(["t"], (t) => k.fold(t, [
      { variant: Tree.v.leaf, names: ["n"], body: ([n]) => k.call(lib("sum"), k.call(lib("map"), k.call(INT_OPS.range, k.int(600000)), k.fn(["i"], (i) => k.call(B.mul, k.call(INT_OPS.toNumber, i), k.call(INT_OPS.toNumber, n))))) },
      { variant: Tree.v.node, names: ["l", "r"], results: ["a", "b"], body: (_, [a, b]) => k.call(B.add, a!, b!) },
    ])));
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(total, k.call(grow, k.int(6), k.int(1)))))));
    return main;
  }, false);
  const js = readFileSync(file, "utf8");
  assert.match(js, /R\.rt\("both\.pure"/);
  const [side, alone] = await Promise.all([run([file], { TERS_BRANCHES: "say", TERS_WORKERS: "3" }), run([file], { TERS_WORKERS: "0" })]);
  assert.equal(side[2], 0, side[1]);
  assert.equal(side[0], alone[0]);
  assert.match(side[1], /branches on workers: [1-9]\d*\n/);
});
