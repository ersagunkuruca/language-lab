// examples/housefit (L285): a house's eight parameters fitted to its
// measured temperatures by Adam, the gradient of a loss over a record
// (Params) worked out in reverse mode, back through a simulation that
// calls itself a step at a time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Session } from "../mcp/session.ts";

const dir = join(import.meta.dirname, "../examples/housefit");
const ones = "params(1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0)";
const fields = (s: string) => /params\(([^)]*)\)/.exec(s)![1].split(", ").map(Number);

test("the gradient over Params is the loss's slopes, as central differences find them", () => {
  const s = new Session(dir);
  const w = "‹weather of›(1, 7)";
  const got = fields(s.eval(`slopes(${ones}, ${w})`));
  const nudged = (i: number, d: string) => `params(${Array.from({ length: 8 }, (_, j) => (j === i ? d : "1.0")).join(", ")})`;
  const diffs = s.eval(`[${Array.from({ length: 8 }, (_, i) => `(loss(${nudged(i, "1.0001")}, ${w}) − loss(${nudged(i, "0.9999")}, ${w})) / 0.0002`).join(", ")}]`);
  const want = /\[([^\]]*)\]/.exec(diffs)![1].split(", ").map(Number);
  assert.equal(got.length, 8);
  got.forEach((g, i) => assert.ok(Math.abs(g - want[i]) < 1e-5 * Math.max(1, Math.abs(want[i])), `part ${i}: ${g} against ${want[i]}`));
});

test("compiled, it fits the house as the evaluator does", () => {
  const run = (...flags: string[]) => spawnSync(process.execPath, [join(import.meta.dirname, "../cli/ters.ts"), "run", dir, "1", "50", ...flags], { encoding: "utf8" });
  const compiled = run(), evaluated = run("--evaluator");
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.match(compiled.stdout, /^loss 0\.834063019 -> 0\.009651535\n/);
  assert.equal(compiled.stdout, evaluated.stdout);
});
