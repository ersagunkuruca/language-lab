// Matrices of any size (L44, MATRICES.md step 3): built from rows, read by
// entry, transposed, added, multiplied, times a vector and solved. A size
// mismatch stops with both sizes; a singular system has no answer.
// Evaluated and compiled give the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { $setPrint } from "../../compiler/src/runtime.js";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { S, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

async function both(lines: (k: Lang) => Id[]): Promise<[string[], string[]]> {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(...lines(k).map((v) => k.call(S.print, k.call(S.first, k.thunk(() => k.call(SHOW_ANY, v)), k.thunk(() => k.lit("none"))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const path = join(mkdtempSync(join(tmpdir(), "matrix-any-size-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];

  return [ran, compiled];
}

test("the types", () => {
  const info = infer(base({ nodes: {}, defs: [] }), baseNames({}), undefined, checkOptions);
  const t = (n: string) => showType(info.subst.zonk(info.typeOf.get(L(n))!), baseNames({}));
  assert.equal(t("matrix of rows"), "(List (List a)) -[Abort]-> Matrix a");
  assert.equal(t("matrix entry"), "(Matrix a, Int, Int) -[Choice]-> a");
  assert.equal(t("matrix product"), "(Matrix a, Matrix a) -[Abort]-> Matrix a");
  assert.equal(t("matrix times vector"), "(Matrix a, List a) -[Abort]-> List a");
  assert.equal(t("solved"), "(Matrix Float64, List Float64) -[Choice, Abort]-> List Float64");
});

const rows = (k: Lang, ...rs: number[][]) => k.call(L("matrix of rows"), k.list(...rs.map((r) => k.list(...r.map((x) => k.lit(x))))));
const vec = (k: Lang, ...xs: number[]) => k.list(...xs.map((x) => k.lit(x)));
const tried = (k: Lang, v: Id) => k.call(L("attempt"), k.thunk(() => v));

test("built, read, transposed, added and multiplied", async () => {
  const [ran, compiled] = await both((k) => [
    k.call(L("matrix rows"), k.call(L("transposed"), rows(k, [1, 2, 3], [4, 5, 6]))),
    k.call(L("row count"), rows(k, [1, 2, 3], [4, 5, 6])),
    k.call(L("column count"), rows(k, [1, 2, 3], [4, 5, 6])),
    k.call(L("matrix entry"), rows(k, [1, 2, 3], [4, 5, 6]), k.int(1), k.int(2)),
    k.call(L("matrix entry"), rows(k, [1, 2, 3], [4, 5, 6]), k.int(2), k.int(0)),
    k.call(L("matrix rows"), k.call(L("matrix product"), rows(k, [1, 2, 3], [4, 5, 6]), rows(k, [7, 8], [9, 10], [11, 12]))),
    k.call(L("matrix rows"), k.call(L("matrix sum"), rows(k, [1, 2], [3, 4]), k.call(L("matrix scaled"), k.call(L("identity matrix"), k.int(2)), k.lit(10)))),
    k.call(L("matrix times vector"), rows(k, [1, 2], [3, 4]), vec(k, 1, 1)),
    k.call(L("matrix rows"), k.call(L("matrix product"), k.call(L("identity matrix"), k.int(2)), rows(k, [1, 2], [3, 4]))),
  ]);
  const want = ["[[1, 4], [2, 5], [3, 6]]", "2", "3", "6", "none", "[[58, 64], [139, 154]]", "[[11, 2], [3, 14]]", "[3, 7]", "[[1, 2], [3, 4]]"];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});

test("a size mismatch stops with both sizes", async () => {
  const [ran, compiled] = await both((k) => [
    tried(k, k.call(L("matrix rows"), k.call(L("matrix product"), rows(k, [1, 2, 3], [4, 5, 6]), rows(k, [1, 2], [3, 4])))),
    tried(k, k.call(L("matrix rows"), k.call(L("matrix sum"), rows(k, [1, 2]), rows(k, [1], [2])))),
    tried(k, k.call(L("matrix times vector"), rows(k, [1, 2]), vec(k, 1, 2, 3))),
    tried(k, k.call(L("row count"), rows(k, [1, 2], [3]))),
  ]);
  const want = [
    'refused("matrix product: a 2 × 3 matrix and a 2 × 2 one")',
    'refused("matrix sum: a 1 × 2 matrix and a 2 × 1 one")',
    'refused("matrix times vector: a 1 × 2 matrix and a vector of 3")',
    `refused("matrix of rows: the rows aren't all 2 long")`,
  ];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});

test("solved finds x with m·x = b, pivoting on the largest; a singular matrix has no answer", async () => {
  const [ran, compiled] = await both((k) => [
    // 2x + y = 5, x + 3y = 10: x = 1, y = 3.
    k.call(L("solved"), rows(k, [2, 1], [1, 3]), vec(k, 5, 10)),
    // A zero first pivot: the rows swap.
    k.call(L("solved"), rows(k, [0, 1, 0], [1, 0, 0], [0, 0, 2]), vec(k, 4, 5, 6)),
    k.call(L("solved"), rows(k, [1, 2], [2, 4]), vec(k, 1, 2)),
    tried(k, k.call(L("solved"), rows(k, [1, 2, 3], [4, 5, 6]), vec(k, 1, 2))),
  ]);
  const want = ["[1, 3]", "[5, 4, 3]", "none", `refused("solved: a 2 × 3 matrix and a vector of 2; it needs a square matrix and one item per row")`];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});

test("determinant and inverted (L44e): pivots multiplied with their sign; a singular matrix", async () => {
  const [ran, compiled] = await both((k) => [
    k.call(L("determinant"), rows(k, [2, 1], [1, 3])),
    // a zero first pivot: rows swap, the sign turns
    k.call(L("determinant"), rows(k, [0, 1, 0], [1, 0, 0], [0, 0, 2])),
    k.call(L("determinant"), rows(k, [1, 2], [2, 4])),
    k.call(L("matrix rows"), k.call(L("inverted"), rows(k, [4, 7], [2, 6]))),
    k.call(L("matrix rows"), k.call(L("matrix product"), rows(k, [2, 0], [0, 4]), k.call(L("inverted"), rows(k, [2, 0], [0, 4])))),
    k.call(L("inverted"), rows(k, [1, 2], [2, 4])),
    tried(k, k.call(L("determinant"), rows(k, [1, 2, 3]))),
  ]);
  const want = ["5", "-2", "0", "[[0.6, -0.7], [-0.2, 0.4]]", "[[1, 0], [0, 1]]", "none", 'refused("determinant: a 1 × 3 matrix; it needs a square one")'];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});

test("least squares (L44f): a line through points that aren't on one", async () => {
  const [ran, compiled] = await both((k) => [
    // y = a + b·x through (0, 1), (1, 2), (2, 4): a = 5/6, b = 3/2
    k.call(L("least squares"), rows(k, [1, 0], [1, 1], [1, 2]), vec(k, 1, 2, 4)),
    // a square system is solved exactly
    k.call(L("least squares"), rows(k, [2, 1], [1, 3]), vec(k, 5, 10)),
    tried(k, k.call(L("least squares"), rows(k, [1, 0], [1, 1]), vec(k, 1, 2, 3))),
  ]);
  assert.equal(ran.length, 3);
  const [a, b] = JSON.parse(ran[0]) as number[];
  assert.ok(Math.abs(a - 5 / 6) < 1e-9 && Math.abs(b - 1.5) < 1e-9, ran[0]);
  const [x, y] = JSON.parse(ran[1]) as number[];
  assert.ok(Math.abs(x - 1) < 1e-9 && Math.abs(y - 3) < 1e-9, ran[1]);
  assert.equal(ran[2], 'refused("least squares: a 2 × 2 matrix and a vector of 3; it needs one item per row")');
  assert.deepEqual(compiled, ran);
});

// LU factors kept (L44g): factored once, then solved with for each vector,
// as solved gives; a singular matrix's have a 0 pivot, so no answer, and
// a wrong size stops.
test("factored once, solved with for many vectors", async () => {
  const m = [[2, 1, 1], [4, -6, 0], [-2, 7, 2]], bs = [[5, -2, 9], [1, 0, 0], [0, 1, 0], [3.5, -1, 2]];
  const [ran, compiled] = await both((k) => [
    ...bs.flatMap((b) => [k.call(L("solved"), rows(k, ...m), vec(k, ...b)),
      k.let("factors", k.call(L("factored"), rows(k, ...m)), (f) => k.call(L("solved with"), f, vec(k, ...b)))]),
    k.call(L("solved with"), k.call(L("factored"), rows(k, [1, 2], [2, 4])), vec(k, 1, 1)),
    tried(k, k.call(L("solved with"), k.call(L("factored"), rows(k, [1, 0], [0, 1])), vec(k, 1, 2, 3))),
  ]);
  for (let i = 0; i < bs.length; i++) assert.equal(ran[2 * i + 1], ran[2 * i], `b = ${bs[i]}`);
  assert.equal(ran[0], "[1, 1, 2]");
  assert.equal(ran[8], "none");
  assert.equal(ran[9], 'refused("solved with: factors of a 2 × 2 matrix and a vector of 3")');
  assert.deepEqual(compiled, ran);
});
