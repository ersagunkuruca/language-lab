// Bounce's step to the first impact (BACKLOG L119): two small balls
// closing at 80 units a second, 0.12 apart, pass through each other in
// one plain frame (each moves 0.67), and bounce off each other in a step
// that goes to the time they touch first. Speculative contacts (L121)
// stop them touching instead, and also bump a ball that would only have
// gone past (a ghost bump), which stepping to impacts doesn't.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { Session } from "../mcp/session.ts";

const ball = (x: number, y: number, v: number, colour: string) =>
  `body(flat(0, ${x}, ${y}, 0), flat(0, ${v}, 0, 0), flat(1, 0, 0, 0), flat(0, 0, 0, 0), 0.02, [], [], "${colour}")`;
const pair = `[${ball(-0.06, 0, 40, "red")}, ${ball(0.06, 0, -40, "blue")}]`;
// The second ball still, 0.1 off the first one's line: they never touch.
const past = `[${ball(-0.3, 0.05, 40, "red")}, ${ball(0, -0.05, 0, "blue")}]`;
// One frame of each step on a world, all read in one evaluation (each
// costs a check of the program): the first ball's velocity or position
// along x.
const runs: [step: string, world: string, field: string][] = [
  ["plain step", pair, "velocity"], ["step", pair, "velocity"], ["speculative step", pair, "position"],
  ["plain step", past, "velocity"], ["step", past, "velocity"], ["speculative step", past, "velocity"],
];

test("Bounce: a step to the first impact meets a ball a plain frame jumps over; speculative contacts stop it, and bump one going past", () => {
  const s = new Session(join(root, "examples", "bounce"));
  const out = s.eval(`[${runs.map(([f, w, field]) => `map(${f}(flat, ${w}), (b) => b.${field})`).join(", ")}]`);
  const xs = [...out.matchAll(/\[flat\(0, (-?[\d.e-]+),/g)].map((m) => Number(m[1]));
  assert.equal(xs.length, runs.length, out);
  const [plain, stepped, speculative, plainPast, steppedPast, speculativePast] = xs;
  assert.ok(plain > 39, "a plain frame: they pass through, still closing");
  assert.ok(stepped < -20 && stepped > -32, `stepped to the impact: they part at about 70% of 40, got ${stepped}`);
  // Speculative contacts: they end the frame touching (centres 0.04 apart), not past.
  assert.ok(speculative < 0 && speculative > -0.03, `stopped touching, got ${speculative}`);
  // The ghost bump: the ball going past is slowed by speculative contacts only.
  assert.ok(plainPast > 39.9 && steppedPast > 39.9, `${plainPast}, ${steppedPast}`);
  assert.ok(speculativePast < 35, "speculative contacts bump a ball that would have gone past");
  // Stepping to impacts doesn't make step Diverge: sub steps counts its tries.
  assert.match(s.defs("step"), /^\w+  step : .*-\[Choice\]->/m);
});
