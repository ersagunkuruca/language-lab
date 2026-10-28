// The lockstep example (FIXED-POINT.md step 4, BACKLOG L89): a cart on a
// spring driven by 600 inputs, all in Fixed. Evaluated, compiled and
// worked out here by hand in BigInt, the final state is the same steps,
// which is what lets two machines share only their inputs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const ONE = 2n ** 32n;
const steps = (top: bigint, bottom: bigint) => { const t = 2n * top * ONE + bottom, d = 2n * bottom; return t >= 0n ? t / d : -((-t + d - 1n) / d); };
const times = (a: bigint, b: bigint) => (a * b) >> 32n;

test("lockstep: the same steps evaluated, compiled and by hand", async () => {
  const p = loadProgram(join(root, "examples", "lockstep"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const evaluated = makeRunner(p.code, info, { print: () => {}, names: p.pres.names }).value(p.named("main"));
  const dt = steps(166666667n, 10000000000n), three = 3n * ONE, two = 2n * ONE, quarter = ONE / 4n;
  let pos = 0n, vel = 0n;
  for (let t = 0; t < 600; t++) {
    const phase = Math.floor(t / 37) % 4, push = phase === 0 ? 1n : phase === 2 ? -1n : 0n;
    const a = times(push * ONE, three) - times(pos, two) - times(vel, quarter);
    vel += times(a, dt);
    pos += times(vel, dt);
  }
  assert.match(String(evaluated), new RegExp(`steps ${pos}$`));
  const path = join(mkdtempSync(join(tmpdir(), "lockstep-")), "lockstep.js");
  writeFileSync(path, compile(p.code, info, p.pres.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.equal(typeof defs.main === "function" ? (defs.main as () => Value)() : defs.main, evaluated);
});
