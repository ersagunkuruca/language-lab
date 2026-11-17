// The strum tuner (L277, examples/strum-tuner): every string of a strum
// read at once, as the core IR's JavaScript. Six strings, each its own
// cents off, read within 2 cents; a low string alone doesn't light the
// strings its harmonics fall on (E2's 247 Hz and B3, its 330 Hz and E4);
// silence reads nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { fromList, toList, type Data, type Value } from "../src/lang/run.ts";
import { compiledDefs } from "../../compiler/src/core-js.ts";

const p = loadProgram(join(root, "examples/strum-tuner"));
const fns = compiledDefs(p.code, infer(p.code, p.pres.names, undefined, p.options), p.pres.names, ["strings heard", "guitar"]);
const GUITAR = [82.40688922821748, 110, 146.8323839587038, 195.99771799087463, 246.94165062806206, 329.6275569128699];

// A strum: each string sounding (null: silent) `off` cents from its pitch,
// its first twelve harmonics falling as 1/n, a third of a second of it.
const strum = (off: (number | null)[], rate: number) => Array.from({ length: 16384 }, (_, i) => {
  let s = 0;
  GUITAR.forEach((f0, j) => {
    const c = off[j];
    if (c === null) return;
    for (let h = 1; h <= 12; h++) s += Math.sin((2 * Math.PI * h * f0 * 2 ** (c / 1200) * i) / rate + j + h) / h;
  });
  return s * 0.05;
});
const read = (xs: number[], rate: number) =>
  (fromList(fns["strings heard"](fns.guitar(), toList(xs), rate) as Value) as Data[]).map((r) => ({ cents: r.fields[0] as number, strength: r.fields[1] as number }));

test("a strum's six strings read at once, each within 2 cents", () => {
  for (const [rate, off] of [[48000, [0, 8, -12, 4, -6, 15]], [44100, [3, -3, 3, -3, 3, -3]], [48000, [-20, 15, 30, -40, 22, -9]]] as const) {
    const got = read(strum([...off], rate), rate);
    got.forEach((r, j) => {
      assert.ok(r.strength >= 0.2, `${rate} string ${j}: heard (${r.strength})`);
      assert.ok(Math.abs(r.cents - off[j]) <= 2, `${rate} string ${j}: ${r.cents} for ${off[j]}`);
    });
  }
});

test("a low string alone lights no string its harmonics fall on, and silence reads nothing", () => {
  const got = read(strum([4, null, null, null, null, null], 48000), 48000);
  assert.ok(Math.abs(got[0].cents - 4) <= 2 && got[0].strength === 1, JSON.stringify(got[0]));
  for (const j of [1, 2, 3, 4, 5]) assert.ok(got[j].strength < 0.2, `string ${j}: ${got[j].strength}`);
  const both = read(strum([4, null, null, null, -8, null], 48000), 48000);
  assert.ok(Math.abs(both[4].cents + 8) <= 2 && both[4].strength >= 0.2, JSON.stringify(both[4]));
  assert.ok(read(new Array(16384).fill(0), 48000).every((r) => r.strength === 0));
});
