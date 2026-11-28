// hail (compiler/gaps/hail), GAPS.md game round 5 (BACKLOG G20):
// rain-page's hail as a benchmark, discs of ice piled on the sill. The
// evaluator, compiled JavaScript, `ters native` and the C and JS by hand
// must print the same digits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skip } from "./c-harness.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), gaps = join(import.meta.dirname, "../gaps"), folder = join(gaps, "hail");
const dir = mkdtempSync(join(tmpdir(), "hail-"));
const js = join(dir, "h.mjs");
const ran = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
ran(process.execPath, [lab, "compile", folder, "-o", js]);

test("hail: 25 ticks of 100 discs, evaluated, compiled and by hand in JS", () => {
  const want = ran(process.execPath, [lab, "run", folder, "25", "100"]);
  assert.equal(want, "tick 25: stones 100, checksum 74.431049\n");
  assert.equal(ran(process.execPath, [js, "25", "100"]), want);
  assert.equal(ran(process.execPath, [join(gaps, "hail.ideal.js"), "25", "100"]), want);
});

test("hail: 100 ticks of 1000 discs, compiled, native and the C by hand", () => {
  const want = ran(process.execPath, [js, "100", "1000"]);
  assert.match(want, /tick 100: stones 1000, checksum 866\.203587\n$/);
  assert.equal(ran(process.execPath, [join(gaps, "hail.ideal.js"), "100", "1000"]), want);
  if (skip) return;
  ran(process.execPath, [lab, "native", folder, "-o", join(dir, "h")]);
  assert.equal(ran(join(dir, "h"), ["100", "1000"]), want);
  ran("cc", ["-O2", "-ffp-contract=off", join(gaps, "hail.ideal.c"), "-o", join(dir, "c"), "-lm"]);
  assert.equal(ran(join(dir, "c"), ["100", "1000"]), want);
});

test("hail: natively the stones aren't copied at every touch the solver applies (C370)", () => {
  if (skip) return;
  // `applied` reads `done.stones`, replaces stones in it and reads
  // `done.touches` at its end: c.ts readFirst reads both fields first, so
  // the record is gone and the stones have one holder at each replace.
  // Copied, 5,000 discs were 140 times the C by hand; in place, about 4.
  ran(process.execPath, [lab, "native", folder, "-o", join(dir, "n")]);
  ran("cc", ["-O2", "-ffp-contract=off", join(gaps, "hail.ideal.c"), "-o", join(dir, "c2"), "-lm"]);
  const timed = (cmd: string) => { const t = performance.now(); const out = ran(cmd, ["20", "5000"]); return { out, ms: performance.now() - t }; };
  const c = timed(join(dir, "c2")), n = timed(join(dir, "n"));
  assert.equal(n.out, c.out);
  assert.ok(n.ms < 20 * c.ms + 1000, `native ${n.ms.toFixed(0)} ms, C ${c.ms.toFixed(0)} ms`);
});
