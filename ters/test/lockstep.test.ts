// The lockstep example (FIXED-POINT.md step 4, BACKLOG L89): a cart on a
// spring driven by 600 inputs, all in Fixed. Evaluated, compiled and
// worked out here by hand in BigInt, the final state is the same steps,
// which is what lets two machines share only their inputs. lockstep-text
// says so in one Text main; lockstep is the page (L261a), whose machine B
// replays the presses through the same simulate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, runMain, type Value } from "../src/lang/run.ts";
import { compiledDefs } from "../../compiler/src/core-js.ts";

const ONE = 2n ** 32n;
const steps = (top: bigint, bottom: bigint) => { const t = 2n * top * ONE + bottom, d = 2n * bottom; return t >= 0n ? t / d : -((-t + d - 1n) / d); };
const times = (a: bigint, b: bigint) => (a * b) >> 32n;

// The cart after the 600 recorded inputs, by hand in BigInt steps of 2⁻³².
const byHand = () => {
  const dt = steps(166666667n, 10000000000n), three = 3n * ONE, two = 2n * ONE, quarter = ONE / 4n;
  let pos = 0n, vel = 0n;
  for (let t = 0; t < 600; t++) {
    const phase = Math.floor(t / 37) % 4, push = phase === 0 ? 1n : phase === 2 ? -1n : 0n;
    const a = times(push * ONE, three) - times(pos, two) - times(vel, quarter);
    vel += times(a, dt);
    pos += times(vel, dt);
  }
  return { pos, vel };
};

test("lockstep: the same steps evaluated, compiled and by hand", async () => {
  const { pos } = byHand();
  const p = loadProgram(join(root, "examples", "lockstep-text"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const evaluated = makeRunner(p.code, info, { print: () => {}, names: p.pres.names }).value(p.named("main"));
  assert.match(String(evaluated), new RegExp(`position in steps of 2⁻³² ${pos}$`));
  // main is a value, and Run main gives it.
  assert.equal(runMain(p.code, info, p.named("main"), { print: () => {}, names: p.pres.names }), evaluated);
  const defs = compiledDefs(p.code, info, p.pres.names, ["main"]) as unknown as Record<string, unknown>;
  assert.equal(typeof defs.main === "function" ? (defs.main as () => Value)() : defs.main, evaluated);
});

test("lockstep, the page: simulate on the recording gives the same steps, and steps of reads them", () => {
  const p = loadProgram(join(root, "examples", "lockstep"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, info, { print: () => {}, names: p.pres.names });
  const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };
  const end = first(r.call(r.value(p.named("simulate")), r.value(p.named("inputs")))) as unknown as { fields: Value[] };
  const count = (x: Value) => BigInt(first(r.call(r.value(p.named("steps of")), x)) as unknown as bigint | number);
  const { pos, vel } = byHand();
  assert.deepEqual([count(end.fields[0]), count(end.fields[1])], [pos, vel]);
});
