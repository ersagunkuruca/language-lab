// A cell's value turned between compiled code's Bools and the runtime's
// along its type's paths only (C347, core-rt.ts turnedBy): what turned
// gives where a Bool can be, the same values as they were where none can.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boolShapesOf, inn, turned, turnedBy } from "../src/core-rt.ts";
import { CONS, NIL } from "../../ters/src/lang/std-ids.ts";

const enc = (x: unknown) => encodeURIComponent(JSON.stringify(x));
const list = (...xs: unknown[]): unknown => xs.reduceRight<unknown>((rest, x) => ({ tag: CONS, fields: [x, rest] }), { tag: NIL, fields: [] });

test("turnedBy turns the Bools a shape names and leaves the rest as it is", () => {
  // A sky: a grip { held: Bool, at: Number } and a list of birds holding no Bool.
  const [sky] = boolShapesOf(enc({ n: [{ t: { sky: [1, -1] } }, { t: { grip: [2, -1] } }, "b"], r: [0] }));
  const birds = list({ tag: "bird", fields: [1, 2] }, { tag: "bird", fields: [3, 4] });
  const v = { tag: "sky", fields: [{ tag: "grip", fields: [true, 5] }, birds] };
  const t = turnedBy(v, inn, sky) as { fields: unknown[] };
  assert.deepEqual(t, turned(v, inn));
  assert.equal(t.fields[1], birds, "the birds are given as they are");
  assert.equal(turnedBy(v, inn, null), v);
});

test("turnedBy walks a list of Bool-holding items along its tail and copies only up to the last change", () => {
  const [l] = boolShapesOf(enc({ n: [{ t: { [CONS]: [1, 0] } }, "b"], r: [0] }));
  const xs = list(true, false, 3), want = turned(xs, inn);
  assert.deepEqual(turnedBy(xs, inn, l), want);
  const long = list(...Array.from({ length: 100000 }, (_, i) => i % 2 === 0));
  const items = (x: unknown) => { const out: unknown[] = []; for (let c = x as { tag: string; fields: unknown[] }; c.tag === CONS; c = c.fields[1] as never) out.push(c.fields[0]); return out; };
  assert.deepEqual(items(turnedBy(long, inn, l)), items(turned(long, inn)));
  const same = list(1, 2, 3);
  assert.equal(turnedBy(same, inn, l), same);
});
