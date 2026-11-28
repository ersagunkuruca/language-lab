// Rain on the greenhouse glass (examples/rain-page), the example of the
// GPU rows (BACKLOG G12 to G19): 20,000 Float32 drops sliding down the
// glass, each tick a map over them, drawn with one draw. Interpreted
// here: its first frame, and a tick with the hand on the glass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { evaluatorCall } from "../src/lang/html.ts";
import { rasterize } from "../src/lang/raster.ts";

const p = loadProgram(join(import.meta.dirname, "../examples/rain-page"));
const info = infer(p.code, p.pres.names, undefined, p.options);
const named = (n: string) => p.own.defs.find((d) => p.pres.names[d] === n)!;
const r = makeRunner(p.code, info, { print: () => {} });
const call = (f: string, ...xs: Value[]) => [...r.call(r.value(named(f)), ...xs)][0] as Value;
type Rec = { fields: Value[] };
// A Float32 as the evaluator holds it: its number in a box.
const num = (v: Value) => (typeof v === "number" ? v : (v as Rec).fields[0] as number);
const items = (l: Value) => { const out: Rec[] = []; for (let c = l as Rec; c.fields.length; c = c.fields[1] as Rec) out.push(c.fields[0] as Rec); return out; };

test("rain: checked, its first frame the dark glass with drops on it", () => {
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const img = rasterize(call("frame of", r.value(named("start pane")), 1.0), 64, 48, evaluatorCall);
  let dark = 0, pale = 0;
  for (let i = 0; i < img.rgba.length; i += 4) {
    const [red, green] = img.rgba.slice(i, i + 2);
    if (green < 40) dark++;
    if (red > 90) pale++;
  }
  // Dark between the drops, where no firefly lights it (G15b1: a
  // thousand of them, each a small light).
  assert.ok(dark > 64 * 48 * 0.05 && pale > 64 * 48 * 0.05, `${dark} dark, ${pale} pale of ${64 * 48}`);
});

test("rain: a tick slides the drops down, and the hand on the glass wipes them", () => {
  const start = r.value(named("start pane"));
  const drops = items((start as Rec).fields[0]);
  assert.equal(drops.length, 20000);
  // Every number a drop keeps is a Float32.
  for (const d of drops.slice(0, 50)) for (const x of d.fields.slice(0, 4).map(num)) assert.equal(Math.fround(x), x);
  // The hand in the middle of the canvas (640 by 480).
  const near = (l: Value) => items(l).filter((d) => Math.abs(num(d.fields[0]) - 0.5) < 0.0625 && Math.abs(num(d.fields[1]) - 0.5) < 0.0625).length;
  const touched = call("touched", start, 320, 240, 1.0);
  const after = call("ticked", touched);
  assert.ok(near((touched as Rec).fields[0]) > 100, "drops where the hand goes");
  assert.ok(near((after as Rec).fields[0]) < 20, `${near((after as Rec).fields[0])} drops left under the hand`);
  // Without the hand, the drops that stay are lower or where they were.
  const slid = items((call("ticked", start) as Rec).fields[0]);
  let lower = 0;
  for (let i = 0; i < drops.length; i++) if (num(slid[i].fields[1]) <= num(drops[i].fields[1])) lower++;
  assert.ok(lower > 19000, `${lower} of 20,000 slid down`);
});

test("rain: looked at closer, the canvas shows the glass's middle and the hand wipes there (G14a)", () => {
  const start = r.value(named("start pane"));
  // The canvas's top left at four times closer is an eighth from the middle.
  const w = (call("touched", start, 0, 0, 4.0) as Rec).fields[1] as Rec;
  assert.deepEqual([num(w.fields[1]), num(w.fields[2])], [0.375, 0.625]);
  assert.deepEqual([1.0, 2.0, 4.0].map((z) => call("closer", z)), [2.0, 4.0, 1.0]);
  // Still the dark glass with drops on it, the drops four times as big.
  const img = rasterize(call("frame of", start, 4.0), 64, 48, evaluatorCall);
  let pale = 0;
  for (let i = 0; i < img.rgba.length; i += 4) if (img.rgba[i] > 90) pale++;
  assert.ok(pale > 64 * 48 * 0.05, `${pale} pale of ${64 * 48}`);
});
