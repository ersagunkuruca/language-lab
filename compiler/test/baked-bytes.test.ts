// A bake's bytes (G16b2, docs/design/targets/BAKING.md): compiled
// JavaScript asks its world for baked/<key>.bin, and gives none where the
// world has no such file; evaluated, always none. Never folded at compile
// time (bake.ts), where there are no bytes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { NONE, SHOW_ANY, SOME } from "../../ters/src/lang/std.ts";
import { compiledDefs } from "../src/core-js.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

test("baked bytes: compiled, the world's baked/<key>.bin or none; evaluated, none (G16b2)", () => {
  const k = new Lang(LIBRARY.code);
  const d = k.def("probe");
  // A value with every input written down, so bake.ts would fold it but
  // for the bytes it reads.
  k.define(d, k.call(SHOW_ANY, k.match(k.call(lib("baked bytes"), k.lit("rain")), [
    { variant: SOME, names: ["b"], body: ([b]) => k.call(lib("byte count"), b) },
    { variant: NONE, names: [], body: () => k.int(-1) },
  ])));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(makeRunner(code, info, { print: () => {}, names }).value(d), "-1");
  const asked: string[] = [];
  const files: Record<string, Uint8Array> = { "baked/rain.bin": new Uint8Array([1, 2, 3]) };
  const world = { readBytes: (p: string) => { asked.push(p); const b = files[p]; if (!b) throw new Error("no file"); return b; } };
  const run = (w: object | undefined) => (compiledDefs(code, info, names, ["probe"], { print: () => {}, world: w } as never) as unknown as Record<string, () => unknown>).probe();
  assert.equal(run(world), "3");
  assert.deepEqual(asked, ["baked/rain.bin"]);
  delete files["baked/rain.bin"];
  assert.equal(run(world), "-1");
  assert.equal(run(undefined), "-1");
});
