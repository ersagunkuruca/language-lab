// Small matrices (BACKLOG L44): Mat2, Mat3 and Mat4 join the one + − ·,
// with · the matrix product from the matrix-unit table, and a plain
// number is that many times the identity. Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARITH, MAT_V, SHOW_ANY } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const product = (n: number, a: number[], b: number[]) => a.map((_, c) => Array.from({ length: n }, (_, j) => a[Math.floor(c / n) * n + j] * b[j * n + (c % n)]).reduce((x, y) => x + y, 0));
const A3 = [1, 2, 0, -1, 3, 4, 2, 0, 1], B3 = [0, 1, 2, 3, -2, 1, 1, 1, 1];
const A4 = Array.from({ length: 16 }, (_, i) => (i * 7) % 5 - 2), B4 = Array.from({ length: 16 }, (_, i) => (i * 3) % 4 - 1);

test("Mat2 to Mat4: the one · is the matrix product, evaluated and compiled", async () => {
  const k = new Lang(LIBRARY.code);
  const m = (n: 2 | 3 | 4, xs: number[]) => k.call(MAT_V[n], ...xs.map((x) => k.lit(x)));
  const names: string[] = [];
  const show = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, k.call(SHOW_ANY, body())); names.push(name); };
  show("mat2 product", () => k.call(ARITH.mul, m(2, [1, 2, 3, 4]), m(2, [5, 6, 7, 8])));
  show("not commutative", () => k.call(ARITH.mul, m(2, [5, 6, 7, 8]), m(2, [1, 2, 3, 4])));
  show("mat3 product", () => k.call(ARITH.mul, m(3, A3), m(3, B3)));
  show("mat4 product", () => k.call(ARITH.mul, m(4, A4), m(4, B4)));
  show("plus two", () => k.call(ARITH.add, m(2, [1, 2, 3, 4]), k.lit(2)));
  show("times the identity", () => k.call(ARITH.mul, k.lit(1), m(4, A4)));
  show("a difference", () => k.call(ARITH.sub, m(3, A3), m(3, B3)));
  const code = base(k.code), info = infer(code, baseNames(k.names), undefined, checkOptions);
  const nm = baseNames(k.names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const at = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const got = names.map((n) => r.value(at(n)));
  const shown = (n: number, xs: number[]) => `mat${n}(${xs.join(", ")})`;
  assert.deepEqual(got, [
    "mat2(19, 22, 43, 50)", "mat2(23, 34, 31, 46)", shown(3, product(3, A3, B3)), shown(4, product(4, A4, B4)),
    "mat2(3, 2, 3, 6)", shown(4, A4), shown(3, A3.map((x, i) => x - B3[i])),
  ]);
  const path = join(mkdtempSync(join(tmpdir(), "mat-")), "mat.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: names }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(names.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), got);
});
