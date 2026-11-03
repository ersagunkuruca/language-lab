// C136: Random drawn from the world in WebAssembly and C. They refused a
// definition that draws a number nobody seeds; now the world seeds the
// generator at its first draw (four bytes of /dev/urandom in C,
// random_get under WASI, Math.random in a JavaScript host). A draw under
// `seeded` gives the seeded numbers still, and the world's go on after.

import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WASI } from "node:wasi";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { RANDOM_OP, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, instantiate, fromText } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";

// [a world draw, the first draw under seeded(7), a world draw], shown.
function program() {
  const k = new Lang(LIBRARY.code);
  const g = k.def("g"), main = k.def("main");
  k.define(g, k.fn(["n"], () => k.let("a", k.call(RANDOM_OP), (a) =>
    k.let("b", k.call(S.seeded, k.lit(7), k.thunk(() => k.call(RANDOM_OP))), (b) =>
      k.let("c", k.call(RANDOM_OP), (c) => k.call(SHOW_ANY, k.list(a, b, c)))))));
  k.define(main, k.thunk(() => k.call(S.print, k.call(g, k.lit(0)))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {} });
  const [seededDraw] = [...r.call(r.value(g), 0)].map((t) => JSON.parse(String(t))[1] as number);
  return { code, names, info, g, main, seededDraw };
}

// Three runs' texts: each draws its own world numbers, in [0, 1), with
// the seeded one in the middle every time.
function check(texts: string[], seededDraw: number) {
  const draws = texts.map((t) => JSON.parse(t) as number[]);
  for (const [a, b, c] of draws) {
    assert.equal(b, seededDraw);
    for (const x of [a, c]) assert.ok(x >= 0 && x < 1, `${x} in [0, 1)`);
    assert.notEqual(a, c);
  }
  assert.equal(new Set(draws.map((d) => d[0])).size, draws.length, "each run draws anew");
}

test("Random from the world in WebAssembly (C136)", async () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.g], { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const f = lowered.funcs.find((x) => x.def === p.g && !x.inner)!;
  const texts = [];
  for (let i = 0; i < 3; i++) {
    const w = await instantiate(emitWasm(lowered)) as unknown as Record<string, (...a: unknown[]) => unknown>;
    texts.push(fromText(w, w[f.name](0)));
  }
  check(texts, p.seededDraw);
});

test("Random from the world under WASI (C136)", async () => {
  const p = program();
  const m = emitWasm(lowerScalar(p.code, p.info, p.names, [p.main], { data: true }), { wasi: true });
  const texts = [];
  for (let i = 0; i < 3; i++) {
    const io = mkdtempSync(join(tmpdir(), "random-wasi-"));
    const stdout = openSync(join(io, "out"), "w");
    const wasi = new WASI({ version: "preview1", args: ["main"], stdout, returnOnExit: true });
    wasi.start(await WebAssembly.instantiate(await WebAssembly.compile(m.bytes), wasi.getImportObject() as WebAssembly.Imports));
    closeSync(stdout);
    texts.push(readFileSync(join(io, "out"), "utf8").trim());
  }
  check(texts, p.seededDraw);
});

test("Random from the world in C (C136)", { skip }, () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.g], { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const i = lowered.funcs.findIndex((x) => x.def === p.g && !x.inner);
  const run = build(lowered);
  // One process per run: the generator is seeded once a process.
  const texts = [0, 1, 2].map(() => String(run([[i, [0]]])[0].value));
  check(texts, p.seededDraw);
});
