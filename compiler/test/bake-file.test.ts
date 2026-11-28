// Baking to a file (G16b3c2, docs/design/targets/BAKING.md): a value
// definition of records and lists of numbers is run once, compiled, its
// answer written to a file behind a header; its body is rewritten into a
// decoder in Ters. Compiled with the file, the answer is read from it, the
// same as computed; without it, or with another key's, computed as
// written; evaluated, as written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY, FLOAT32_TYPE } from "../../ters/src/lang/library.ts";
import { SHOW_ANY, INT_OPS } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { BOOL } from "../../ters/src/lang/std-ids.ts";
import { INT, NUMBER } from "../../ters/src/lang/types.ts";
import { compiledDefs } from "../src/core-js.ts";
import { bake, bakedPage, layoutOf, withDecoder } from "../src/bake-file.ts";
import type { Id } from "../../ters/src/model.ts";
import { bakeFile } from "../src/bake-header.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name) ?? LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

test("a bake's file and decoder give the answer as computed, compiled; without the file, the body as written (G16b3c2)", () => {
  const k = new Lang(LIBRARY.code);
  const asFloat32 = LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "as float32")!;
  const Dot = k.type("Dot", [], [["dot", [["x", () => k.tref(FLOAT32_TYPE)], ["y", () => k.tref(NUMBER)], ["seed", () => k.tref(INT)], ["lit", () => k.tref(BOOL)]]]]);
  const Glass = k.type("Glass", [], [["glass", [["dots", () => k.tref("std.list", k.tref(Dot.def))], ["spare", () => k.tref(NUMBER)], ["tick", () => k.tref(INT)]]]]);
  const n = k.def("count");
  k.define(n, k.int(300));
  const start = k.def("start glass");
  const num = (i: number | bigint | string) => k.call(INT_OPS.toNumber, k.int(i));
  k.define(start, k.call(Glass.v.glass,
    k.call(lib("map"), k.call(INT_OPS.range, k.x(n)), k.fn(["i"], (i) => k.call(Dot.v.dot,
      k.call(asFloat32, k.call(B.div, k.call(INT_OPS.toNumber, i), k.lit(7))),
      k.call(B.sub, k.call(B.mul, k.call(INT_OPS.toNumber, i), k.lit(-1.25e-3)), k.lit(1e-310)),
      k.call(INT_OPS.sub, k.call(INT_OPS.mul, i, i), k.int(40000)),
      k.equal(k.call(INT_OPS.remainder, i, k.int(3)), k.int(0))))),
    num(2), k.int(-7)));
  const shown = k.def("shown");
  k.define(shown, k.call(SHOW_ANY, k.x(start)));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.ok(layoutOf(code, info, info.subst.zonk(info.schemes.get(start)!.type)));
  const asWritten = makeRunner(code, info, { print: () => {}, names }).value(shown);

  const baked = bake(code, info, names, start);
  assert.ok(typeof baked !== "string", String(baked));
  // The header, then a length (300), then 300 dots of 20 bytes, 8 and 4.
  assert.equal(baked.file.length, 20 + baked.key.length + 4 + 300 * 20 + 8 + 4);

  const rewritten = withDecoder(code, info, baked);
  const info2 = infer(rewritten, names, undefined, checkOptions);
  assert.deepEqual(info2.errors.map((e) => e.message), []);
  // Evaluated, the bytes are none: the body as written.
  assert.equal(makeRunner(rewritten, info2, { print: () => {}, names }).value(shown), asWritten);
  const files: Record<string, Uint8Array> = { [`baked/${baked.key}.bin`]: baked.file };
  const asked: string[] = [];
  const world = { readBytes: (p: string) => { asked.push(p); const b = files[p]; if (!b) throw new Error("no file"); return b; } };
  const run = () => (compiledDefs(rewritten, info2, names, ["shown"], { print: () => {}, world } as never) as unknown as Record<string, () => unknown>).shown();
  assert.equal(run(), asWritten);
  assert.deepEqual(asked, [`baked/${baked.key}.bin`]);
  // Read from the file: a file of the right key with other dots reads as
  // those dots.
  const other = new Uint8Array(baked.file.length - 20 - baked.key.length);
  other.set(baked.file.subarray(20 + baked.key.length));
  new DataView(other.buffer).setFloat64(4 + 4, 0.5, true);
  files[`baked/${baked.key}.bin`] = bakeFile(baked.key, other);
  assert.match(String(run()), /^glass\(\[dot\(0, 0\.5, /);
  // Another key's file, or none: as written.
  files[`baked/${baked.key}.bin`] = bakeFile("another", other);
  assert.equal(run(), asWritten);
  delete files[`baked/${baked.key}.bin`];
  assert.equal(run(), asWritten);
});

test("a bake refuses a function, a text, and an Int past 32 bits (G16b3c2)", () => {
  const k = new Lang(LIBRARY.code);
  const f = k.def("f"), t = k.def("t"), big = k.def("big");
  k.define(f, k.fn(["x"], (x) => x));
  k.define(t, k.lit("text"));
  k.define(big, k.list(k.int(2n ** 40n)));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.equal(bake(code, info, names, f), "isn't a value");
  assert.equal(bake(code, info, names, t), "its answer isn't numbers in records and lists");
  assert.match(String(bake(code, info, names, big)), /its encoder stopped/);
});

test("a page bakes an answer where reading it back pays (G16b3c3)", () => {
  const k = new Lang(LIBRARY.code);
  const Spot = k.type("Spot", [], [["spot", [["x", () => k.tref(NUMBER)], ["n", () => k.tref(INT)]]]]);
  // Heavy: each spot sums 3,000 numbers. Light: each is its index.
  const heavy = k.def("heavy spots"), light = k.def("light spots");
  const sum = (i: Id) => k.call(lib("sum"), k.call(lib("map"), k.call(INT_OPS.range, k.int(3000)), k.fn(["j"], (j) => k.call(B.div, k.call(INT_OPS.toNumber, k.call(INT_OPS.mul, i, j)), k.lit(7)))));
  k.define(heavy, k.call(lib("map"), k.call(INT_OPS.range, k.int(400)), k.fn(["i"], (i) => k.call(Spot.v.spot, sum(i), i))));
  k.define(light, k.call(lib("map"), k.call(INT_OPS.range, k.int(400)), k.fn(["i"], (i) => k.call(Spot.v.spot, k.call(INT_OPS.toNumber, i), i))));
  const main = k.def("shown");
  k.define(main, k.call(SHOW_ANY, k.list(k.call(SHOW_ANY, k.x(heavy)), k.call(SHOW_ANY, k.x(light)))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const asWritten = makeRunner(code, info, { print: () => {}, names }).value(main);
  const page = bakedPage(code, info, names, main, checkOptions);
  const by = Object.fromEntries(page.weighed.map((w) => [w.name, w]));
  assert.equal(by["heavy spots"]?.baked, true, JSON.stringify(by["heavy spots"]));
  // Each is baked just where reading it back is under 90% of computing
  // it (timed, so light spots may go either way; rain-page's start pane,
  // measured in BAKING.md, doesn't pay).
  for (const w of page.weighed) assert.equal(w.baked, w.decodeMs + w.carryMs < 0.9 * w.computeMs, JSON.stringify(w));
  assert.equal(Object.keys(page.files).length, page.weighed.filter((w) => w.baked).length);
  const world = { readBytes: (p: string) => { const b = page.files[p]; if (!b) throw new Error("no file"); return b; } };
  const shown = (compiledDefs(page.code, page.info, names, ["shown"], { print: () => {}, world } as never) as unknown as Record<string, () => unknown>).shown();
  assert.equal(shown, asWritten);
  // Held (G16d): heavy spots at start, computed as written; light spots
  // baked to a file though it doesn't pay. Neither is timed.
  const held = bakedPage(code, info, names, main, checkOptions, new Map([[heavy, "at start"], [light, "baked to a file"]]));
  const was = Object.fromEntries(held.weighed.map((w) => [w.name, w]));
  assert.deepEqual([was["heavy spots"]?.baked, was["heavy spots"]?.held, was["light spots"]?.baked, was["light spots"]?.held], [false, "at start", true, "baked to a file"]);
  assert.equal(was["light spots"]?.computeMs, 0);
  assert.equal(Object.keys(held.files).length, 1);
  const heldWorld = { readBytes: (p: string) => { const b = held.files[p]; if (!b) throw new Error("no file"); return b; } };
  assert.equal((compiledDefs(held.code, held.info, names, ["shown"], { print: () => {}, world: heldWorld } as never) as unknown as Record<string, () => unknown>).shown(), asWritten);
});

test("a page's bakes and weighings are read back from the store (G16d2)", () => {
  const k = new Lang(LIBRARY.code);
  const Spot = k.type("Spot", [], [["spot", [["x", () => k.tref(NUMBER)], ["n", () => k.tref(INT)]]]]);
  const spots = k.def("spots"), main = k.def("shown");
  k.define(spots, k.call(lib("map"), k.call(INT_OPS.range, k.int(50)), k.fn(["i"], (i) => k.call(Spot.v.spot, k.call(INT_OPS.toNumber, i), i))));
  k.define(main, k.call(SHOW_ANY, k.x(spots)));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const files = new Map<string, Uint8Array>(), weighings = new Map<string, { computeMs: number; decodeMs: number }>();
  let made = 0, timed = 0;
  const store = { file: (key: string) => files.get(key), keepFile: (key: string, f: Uint8Array) => { made++; files.set(key, f); }, weighed: (key: string) => weighings.get(key), keepWeighed: (key: string, w: { computeMs: number; decodeMs: number }) => { timed++; weighings.set(key, w); } };
  const first = bakedPage(code, info, names, main, checkOptions, new Map(), store);
  assert.deepEqual([made, timed], [1, 1]);
  // Again: no bake run, nothing timed, the same verdict.
  const again = bakedPage(code, info, names, main, checkOptions, new Map(), store);
  assert.deepEqual([made, timed], [1, 1]);
  assert.deepEqual(again.weighed, first.weighed);
  // Weighed as faster to read back: baked, from the kept file.
  const [key] = files.keys();
  weighings.set(key, { computeMs: 100, decodeMs: 1 });
  const paid = bakedPage(code, info, names, main, checkOptions, new Map(), store);
  assert.deepEqual([made, timed, paid.weighed[0].baked], [1, 1, true]);
  assert.deepEqual(paid.files[`baked/${key}.bin`], files.get(key));
  const world = { readBytes: (p: string) => { const b = paid.files[p]; if (!b) throw new Error("no file"); return b; } };
  const asWritten = makeRunner(code, info, { print: () => {}, names }).value(main);
  assert.equal((compiledDefs(paid.code, paid.info, names, ["shown"], { print: () => {}, world } as never) as unknown as Record<string, () => unknown>).shown(), asWritten);
});
