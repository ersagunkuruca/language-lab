// flock (compiler/gaps/flock), GAPS.md game round 3 (BACKLOG G6d): 3D
// boids, each seeing its `neighbours`, the stress test beside Night watch. The
// evaluator, compiled JavaScript, `ters native` and the C by hand must
// print the same digits, so the program steers by a swept goal instead of
// sin and cos.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skip } from "./c-harness.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), gaps = join(import.meta.dirname, "../gaps"), folder = join(gaps, "flock");
const dir = mkdtempSync(join(tmpdir(), "flock-"));
const js = join(dir, "f.mjs");
const ran = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
ran(process.execPath, [lab, "compile", folder, "-o", js]);

test("flock: 50 ticks of 300 birds, evaluated, compiled and by hand in JS", () => {
  const want = ran(process.execPath, [lab, "run", folder, "50", "300"]);
  assert.match(want, /^tick 25: checksum 104099\.948241, mean speed 0\.884289\n/);
  assert.equal(ran(process.execPath, [js, "50", "300"]), want);
  // The birds as a column per leaf field, their places' and velocities'
  // parts too (columns.ts whole, G3d).
  assert.match(readFileSync(js, "utf8"), /c5: new Float64Array/, "the birds are columns");
  assert.equal(ran(process.execPath, [join(gaps, "flock.ideal.js"), "50", "300"]), want);
});

test("flock: 200 ticks of 2000 birds, compiled, native and the C by hand", () => {
  const want = ran(process.execPath, [js, "200", "2000"]);
  assert.match(want, /tick 200: checksum 787441\.154895, mean speed 0\.930279\n/);
  if (skip) return;
  ran(process.execPath, [lab, "native", folder, "-o", join(dir, "f")]);
  assert.equal(ran(join(dir, "f"), ["200", "2000"]), want);
  ran("cc", ["-O2", "-ffp-contract=off", join(gaps, "flock.ideal.c"), "-o", join(dir, "c"), "-lm"]);
  assert.equal(ran(join(dir, "c"), ["200", "2000"]), want);
});

test("flock: natively the birds' neighbours are found on a grid, not by every pair (C292)", () => {
  if (skip) return;
  ran(process.execPath, [lab, "native", folder, "-o", join(dir, "w")]);
  assert.match(readFileSync(join(dir, "w.c"), "utf8"), /lab_grid_found/);
});
