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

// The hand off the glass, as the hail keeps it before it is ever put on.
const handOff = () => (r.value(named("no hail")) as Rec).fields[3];

test("rain: hail strikes the glass, falls and comes to rest on the sill (G19a)", () => {
  // The stones as the hail keeps them: (id, x, y, angle, vx, vy, spin,
  // radius, chip); the discs' geometry checked here, the chips' with G19b.
  const chip = (v: Value) => (v as { tag?: string }).tag === "std.bool.true";
  const stones = (h: Value) => items((h as Rec).fields[0]).map((s) => [...s.fields.slice(0, 8).map(num), chip(s.fields[8]) ? 1 : 0]);
  let h = r.value(named("no hail"));
  // It hails from tick 120, a stone every fifth tick: thirty of them.
  for (let tick = 120; tick < 270; tick++) h = call("hail ticked", h, tick, handOff());
  assert.equal(stones(h).length, 30);
  // Then it stops (tick 1000 is between showers), and the pile settles.
  for (let tick = 1000; tick < 1250; tick++) h = call("hail ticked", h, tick, handOff());
  const pile = stones(h);
  // They melt as they lie: the smallest are gone by now.
  assert.ok(pile.length > 20 && pile.length < 30, `${pile.length} stones left`);
  const sill = 0.05, width = 640 / 480;
  let fastest = 0;
  for (const [, x, y, , vx, vy, , radius, isChip] of pile) {
    // On the sill or above it, between the frame's sides, overlapping
    // nothing by more than the solver's slop and a little more.
    if (!isChip) assert.ok(y - radius > sill - 0.004, `a stone ${(sill - (y - radius)).toFixed(4)} into the sill`);
    assert.ok(x - radius > -0.004 && x + radius < width + 0.004, `a stone at ${x}`);
    fastest = Math.max(fastest, Math.hypot(vx, vy));
  }
  for (let i = 0; i < pile.length; i++) for (let j = i + 1; j < pile.length; j++) {
    const [a, b] = [pile[i], pile[j]];
    if (!a[8] && !b[8]) assert.ok(Math.hypot(a[1] - b[1], a[2] - b[2]) > a[7] + b[7] - 0.004, "two stones deep in each other");
  }
  // At rest: the fastest stone no faster than a tick of gravity (1.5
  // a second each second), as a stone melting off its touch falls a tick
  // before it touches again; they strike the glass at 0.6 a second.
  assert.ok(fastest < 0.03, `the fastest stone still moves ${fastest.toFixed(4)} a second`);
});

test("rain: five chips of ice stacked on the sill stand, and the hail tumbles chips and discs into a pile (G19b)", () => {
  type Data = { tag: string; fields: Value[] };
  const none = r.value(named("no hail")) as Data, stone = r.value(named("no stone")) as Data;
  const drops = (r.value(named("start pane")) as Data).fields[0] as Data;
  const list = (xs: Value[]): Value => xs.reduceRight((t: Value, x) => ({ tag: drops.tag, fields: [x, t] }), { tag: (none.fields[0] as Data).tag, fields: [] });
  const truth = (b: boolean) => ({ tag: b ? "std.bool.true" : "std.bool.false", fields: [] });
  const flag = (v: Value) => (v as Data).tag === "std.bool.true";
  const stones = (h: Value) => items((h as Rec).fields[0]).map((s) => ({ x: num(s.fields[1]), y: num(s.fields[2]), angle: num(s.fields[3]), v: Math.hypot(num(s.fields[4]), num(s.fields[5])), r: num(s.fields[7]), chip: flag(s.fields[8]) }));
  // Five chips 0.04 long and 0.02 thick, each laid on the one below, a
  // little to one side and the other.
  const chip = (k: number) => ({ tag: stone.tag, fields: [k + 1, 0.6 + 0.002 * (k % 2), 0.05 + 0.0101 + 0.0201 * k, 0, 0, 0, 0, 0.02, truth(true)] });
  let h: Value = { tag: none.tag, fields: [list([0, 1, 2, 3, 4].map(chip)), none.fields[1], 1, none.fields[3]] };
  for (let tick = 1000; tick < 1240; tick++) h = call("hail ticked", h, tick, handOff());
  const stack = stones(h);
  assert.equal(stack.length, 5);
  stack.forEach((s, k) => {
    // Each still on the one below, level, at rest, though melting thinner.
    assert.ok(Math.abs(s.x - 0.6) < 0.01, `chip ${k} slid to ${s.x}`);
    assert.ok(Math.abs(s.angle) < 0.1, `chip ${k} turned ${s.angle}`);
    assert.ok(s.v < 0.05, `chip ${k} moves ${s.v}`);
    if (k) assert.ok(Math.abs(s.y - stack[k - 1].y - s.r) < 0.003, `chip ${k} ${s.y - stack[k - 1].y} above the one below, ${s.r} thick`);
  });
  // The hail: a stone every fifth tick, four in ten of them chips.
  h = r.value(named("no hail"));
  for (let tick = 120; tick < 270; tick++) h = call("hail ticked", h, tick, handOff());
  for (let tick = 1000; tick < 1250; tick++) h = call("hail ticked", h, tick, handOff());
  const pile = stones(h);
  assert.ok(pile.some((s) => s.chip) && pile.some((s) => !s.chip));
  for (const s of pile) {
    // A chip lies on a side, flat or on its end; nothing is in the sill.
    const lowest = s.chip ? s.y - s.r * Math.max(Math.abs(Math.sin(s.angle)) + 0.5 * Math.abs(Math.cos(s.angle)), 0) : s.y - s.r;
    assert.ok(lowest > 0.046, `a stone ${0.05 - lowest} into the sill`);
    assert.ok(s.v < 0.03, `a stone still moves ${s.v}`);
  }
});

test("rain: the hand pushes the hail along the sill and sweeps it off the end (G19c)", () => {
  type Data = { tag: string; fields: Value[] };
  const off = handOff() as Data, width = 640 / 480;
  // The hand on the glass at x, y in glass heights (a wipe keeps x as a share of the width).
  const f32 = (n: number): Value => ({ tag: (off.fields[1] as Data).tag, fields: [Math.fround(n)] });
  const hand = (x: number, y: number): Value => ({ tag: off.tag, fields: [{ tag: "std.bool.true", fields: [] }, f32(x / width), f32(y)] });
  const stones = (h: Value) => items((h as Rec).fields[0]).map((s) => ({ id: num(s.fields[0]), x: num(s.fields[1]), y: num(s.fields[2]), v: Math.hypot(num(s.fields[4]), num(s.fields[5])), r: num(s.fields[7]) }));
  let h = r.value(named("no hail"));
  for (let tick = 120; tick < 270; tick++) h = call("hail ticked", h, tick, off);
  for (let tick = 1000; tick < 1250; tick++) h = call("hail ticked", h, tick, off);
  const before = stones(h);
  const right = before.filter((s) => s.x > 0.75), left = before.filter((s) => s.x + s.r < 0.45);
  assert.ok(right.length >= 3 && left.length >= 3, `${right.length} stones to the right, ${left.length} to the left`);
  // The hand put down at 0.6 just above the sill (its middle 0.11 up,
  // its reach 0.0625) and drawn right off the glass's edge, 0.6 glass
  // heights a second, then lifted.
  // And the same ticks with the hand off, as the stones melt anyway.
  let tick = 1250, still = h;
  for (let x = 0.6; x < width + 0.15; x += 0.01) { still = call("hail ticked", still, tick, off); h = call("hail ticked", h, tick++, hand(x, 0.11)); }
  for (let k = 0; k < 120; k++) { still = call("hail ticked", still, tick, off); h = call("hail ticked", h, tick++, off); }
  const after = stones(h), ids = new Set(after.map((s) => s.id)), kept = new Set(stones(still).map((s) => s.id));
  // What was right of the hand is swept off the end; what was left of
  // where it went down is still there if it hasn't melted, and the rest
  // at rest again.
  const stayed = right.filter((s) => kept.has(s.id));
  assert.ok(stayed.length >= 3, `${stayed.length} stones on the right left unmelted`);
  assert.ok(stayed.filter((s) => ids.has(s.id)).length <= 1, `${stayed.filter((s) => ids.has(s.id)).length} of ${stayed.length} stones left on the right`);
  for (const s of left) if (kept.has(s.id)) assert.ok(ids.has(s.id), `stone ${s.id} on the left gone`);
  for (const s of after) assert.ok(s.v < 0.03, `a stone still moves ${s.v}`);
});

test("rain: a stone shot at the sill ten times as fast as hail falls stops on it, not in it (G19d)", () => {
  type Data = { tag: string; fields: Value[] };
  const none = r.value(named("no hail")) as Data, stone = r.value(named("no stone")) as Data;
  const drops = (r.value(named("start pane")) as Data).fields[0] as Data;
  for (const chip of [false, true]) {
    // At 6 glass heights a second, a tenth of one a tick: more than eight
    // times its size, so a stone found touching only once it overlaps
    // would be far into the sill first.
    const s = { tag: stone.tag, fields: [7, 0.6, 0.3, 0.3, 0, -6.0, 0, 0.012, { tag: chip ? "std.bool.true" : "std.bool.false", fields: [] }] };
    let h: Value = { tag: none.tag, fields: [{ tag: drops.tag, fields: [s, { tag: (none.fields[0] as Data).tag, fields: [] }] }, none.fields[1], 1, handOff()] };
    let deepest = 0, last: Rec = s;
    for (let tick = 1000; tick < 1090; tick++) {
      h = call("hail ticked", h, tick, handOff());
      last = items((h as Rec).fields[0])[0];
      const [y, a, radius] = [num(last.fields[2]), num(last.fields[3]), num(last.fields[7])];
      const low = chip ? y - radius * (Math.abs(Math.sin(a)) + 0.5 * Math.abs(Math.cos(a))) : y - radius;
      deepest = Math.max(deepest, 0.05 - low);
    }
    assert.ok(deepest < 0.002, `a ${chip ? "chip" : "disc"} ${deepest.toFixed(4)} into the sill`);
    // And it rests there, not thrown back up by the overlap pushed out.
    assert.ok(num(last.fields[2]) < 0.07 && Math.abs(num(last.fields[5])) < 0.03, `a ${chip ? "chip" : "disc"} at ${num(last.fields[2])}`);
  }
});
