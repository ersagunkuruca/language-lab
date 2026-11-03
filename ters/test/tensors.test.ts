// Tensors (L51, TENSORS-2026-11-03.md step a): a shape and its items
// row-major, made by tensor of, read by index, mapped and zipped item by
// item, reshaped; a shape mismatch stops and names both shapes. The
// evaluator and compiled JavaScript give the same answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { Aborted, runMain } from "../src/lang/run.ts";
import { ARITH, PAIR_V, S, SHOW_ANY, TENSOR_V } from "../src/lang/std.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

// main shows what `body` builds, with a 2 × 3 tensor of 1 to 6 at hand.
function program(body: (k: Lang, t: Id) => Id) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const ints = (...xs: number[]) => k.listOf(...xs.map((x) => k.int(x)));
  k.define(main, k.thunk(() => k.call(SHOW_ANY, body(k, k.call(lib("tensor of"), ints(2, 3), k.listOf(...[1, 2, 3, 4, 5, 6].map((x) => k.lit(x))))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  return { code, names, info, main };
}
const ran = (p: ReturnType<typeof program>) => runMain(p.code, p.info, p.main, { print: () => {}, names: p.names });
async function compiled(p: ReturnType<typeof program>): Promise<unknown> {
  const path = join(mkdtempSync(join(tmpdir(), "tensors-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  return typeof defs.main === "function" ? defs.main() : defs.main;
}
const both = async (body: (k: Lang, t: Id) => Id) => {
  const p = program(body);
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const v = ran(p);
  assert.equal(await compiled(p), v);
  return v;
};

// The item at an index, or 0 where there is none.
const at = (k: Lang, t: Id, ...ix: number[]) => k.call(S.first, k.thunk(() => k.call(lib("tensor entry"), t, k.listOf(...ix.map((x) => k.int(x))))), k.thunk(() => k.lit(0)));

test("a 2 × 3 tensor: its shape, rank and size, and the item at an index", async () => {
  assert.equal(await both((k, t) => k.call(lib("tensor shape"), t)), "[2, 3]");
  assert.equal(await both((k, t) => k.call(lib("rank"), t)), "2");
  assert.equal(await both((k, t) => k.call(lib("tensor size"), t)), "6");
  assert.equal(await both((k, t) => at(k, t, 1, 2)), "6");
  assert.equal(await both((k, t) => at(k, t, 0, 1)), "2");
  // Outside the shape, or the wrong number of positions: no item.
  assert.equal(await both((k, t) => at(k, t, 2, 0)), "0");
  assert.equal(await both((k, t) => at(k, t, 1)), "0");
});

test("map and zip with go item by item; reshaped reads the same items with another shape", async () => {
  assert.equal(await both((k, t) => k.call(lib("tensor items"), k.call(lib("tensor map"), k.fn(["x"], (x) => k.call(ARITH.mul, x, x)), t))), "[1, 4, 9, 16, 25, 36]");
  assert.equal(await both((k, t) => k.call(lib("tensor items"), k.call(lib("tensor zip with"), k.fn(["x", "y"], (x, y) => k.call(ARITH.add, x, y)), t, t))), "[2, 4, 6, 8, 10, 12]");
  assert.equal(await both((k, t) => at(k, k.call(lib("reshaped"), t, k.listOf(k.int(3), k.int(2))), 2, 0)), "5");
});

test("a shape mismatch stops and names both shapes", () => {
  const stops = (body: (k: Lang, t: Id) => Id, why: RegExp) => {
    const p = program(body);
    assert.deepEqual(p.info.errors.map((e) => e.message), []);
    assert.throws(() => ran(p), (e: unknown) => e instanceof Aborted && why.test(e.reason));
  };
  stops((k) => k.call(lib("tensor of"), k.listOf(k.int(2), k.int(2)), k.listOf(k.lit(1))), /a 2 × 2 shape holds 4 items, not 1/);
  stops((k, t) => k.call(lib("tensor zip with"), k.fn(["x", "y"], (x) => x), t, k.call(lib("reshaped"), t, k.listOf(k.int(6)))), /a 2 × 3 tensor and a 6 one/);
  stops((k, t) => k.call(lib("reshaped"), t, k.listOf(k.int(4))), /a 2 × 3 tensor can't be read as 4/);
});

test("a tensor is made by tensor of: its constructor is the library's", () => {
  const k = new Lang(LIBRARY.code);
  const d = k.def("raw");
  k.define(d, k.call(TENSOR_V, k.listOf(k.int(2)), k.listOf(k.lit(1))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.ok(info.errors.some((e) => /tensor of/.test(e.message)), info.errors.map((e) => e.message).join("; "));
});

// Step b: one contraction, and a transpose and a trace.
const pairs = (k: Lang, ...ps: [number, number][]) => k.listOf(...ps.map(([a, b]) => k.call(PAIR_V, k.int(a), k.int(b))));
const items = (k: Lang, t: Id) => k.call(lib("tensor items"), t);
const tensor = (k: Lang, shape: number[], xs: number[]) => k.call(lib("tensor of"), k.listOf(...shape.map((x) => k.int(x))), k.listOf(...xs.map((x) => k.lit(x))));

test("contracted over one pair is matrix product, the same as Matrix's; over none the outer product; over both a dot", async () => {
  // [[1, 2, 3], [4, 5, 6]] times [[1, 0], [0, 1], [1, 1]] is [[4, 5], [10, 11]].
  const b = (k: Lang) => tensor(k, [3, 2], [1, 0, 0, 1, 1, 1]);
  assert.equal(await both((k, t) => items(k, k.call(lib("contracted"), t, b(k), pairs(k, [1, 0])))), "[4, 5, 10, 11]");
  assert.equal(await both((k, t) => k.call(lib("tensor shape"), k.call(lib("contracted"), t, b(k), pairs(k, [1, 0])))), "[2, 2]");
  const rows = (k: Lang, rs: number[][]) => k.call(lib("matrix of rows"), k.listOf(...rs.map((r) => k.listOf(...r.map((x) => k.lit(x))))));
  assert.equal(await both((k) => k.call(lib("matrix rows"), k.call(lib("matrix product"), rows(k, [[1, 2, 3], [4, 5, 6]]), rows(k, [[1, 0], [0, 1], [1, 1]])))), "[[4, 5], [10, 11]]");
  const u = (k: Lang) => tensor(k, [3], [1, 2, 3]);
  assert.equal(await both((k) => items(k, k.call(lib("contracted"), u(k), u(k), pairs(k, [0, 0])))), "[14]");
  assert.equal(await both((k) => k.call(lib("tensor shape"), k.call(lib("contracted"), u(k), u(k), pairs(k)))), "[3, 3]");
  // The whole 2 × 3 tensor against itself on both axes: 1 + 4 + … + 36.
  assert.equal(await both((k, t) => items(k, k.call(lib("contracted"), t, t, pairs(k, [0, 0], [1, 1])))), "[91]");
});

test("transposed by reorders the axes; traced sums a diagonal; a pair or order that doesn't fit stops", async () => {
  assert.equal(await both((k, t) => items(k, k.call(lib("transposed by"), t, k.listOf(k.int(1), k.int(0))))), "[1, 4, 2, 5, 3, 6]");
  assert.equal(await both((k) => items(k, k.call(lib("traced"), tensor(k, [2, 2], [1, 2, 3, 4]), k.int(0), k.int(1)))), "[5]");
  const stops = (body: (k: Lang, t: Id) => Id, why: RegExp) => {
    const p = program(body);
    assert.deepEqual(p.info.errors.map((e) => e.message), []);
    assert.throws(() => ran(p), (e: unknown) => e instanceof Aborted && why.test(e.reason));
  };
  stops((k, t) => k.call(lib("contracted"), t, t, pairs(k, [1, 0])), /contracted: the pairs don't fit a 2 × 3 tensor and a 2 × 3 one/);
  stops((k, t) => k.call(lib("transposed by"), t, k.listOf(k.int(0), k.int(0))), /transposed by: the order doesn't name each axis of a 2 × 3 tensor once/);
  stops((k, t) => k.call(lib("traced"), t, k.int(0), k.int(1)), /traced: two different axes of the same length, of a 2 × 3 tensor/);
});

test("contracted works on Int tensors too: the one + and ·", async () => {
  const p = program((k) => items(k, k.call(lib("contracted"),
    k.call(lib("tensor of"), k.listOf(k.int(2)), k.listOf(k.int(2), k.int(3))),
    k.call(lib("tensor of"), k.listOf(k.int(2)), k.listOf(k.int(4), k.int(5))), pairs(k, [0, 0]))));
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.equal(ran(p), "[23]");
});
