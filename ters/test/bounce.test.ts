// Bounce's step to the first impact (BACKLOG L119): two small balls
// closing at 80 units a second, 0.12 apart, pass through each other in
// one plain frame (each moves 0.67), and bounce off each other in a step
// that goes to the time they touch first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { Session } from "../mcp/session.ts";

const ball = (x: number, v: number, colour: string) =>
  `body(flat(0, ${x}, 0, 0), flat(0, ${v}, 0, 0), flat(1, 0, 0, 0), flat(0, 0, 0, 0), 0.02, [], [], "${colour}")`;
const pair = `[${ball(-0.06, 40, "red")}, ${ball(0.06, -40, "blue")}]`;
// The first ball's velocity along x, after one frame.
const along = (s: Session, step: string) => {
  const out = s.eval(`map(${step}(flat, ${pair}), (b) => b.velocity)`);
  const m = /^= \[flat\(0, (-?[\d.e-]+),/.exec(out);
  assert.ok(m, out);
  return Number(m[1]);
};

test("Bounce: a step to the first impact meets a ball a plain frame jumps over", () => {
  const s = new Session(join(root, "examples", "bounce"));
  assert.ok(along(s, "plain step") > 39, "a plain frame: they pass through, still closing");
  const v = along(s, "step");
  assert.ok(v < -20 && v > -32, `stepped to the impact: they part at about 70% of 40, got ${v}`);
  // Stepping to impacts doesn't make step Diverge: sub steps counts its tries.
  assert.match(s.defs("step"), /^\w+  step : .*-\[Choice\]->/m);
});
