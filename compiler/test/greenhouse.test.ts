// greenhouse (compiler/gaps/greenhouse), GAPS.md game round 2 (BACKLOG
// G6): a night in a greenhouse, its moths, plants and lamps one Pool of
// things with optional parts, each tick a few systems over the pool. The
// evaluator, compiled JavaScript and `ters native` must print the same
// lines, the plants eaten and the lamp moved included.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skip } from "./c-harness.ts";

const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), folder = join(import.meta.dirname, "../gaps/greenhouse");
const dir = mkdtempSync(join(tmpdir(), "greenhouse-"));
const js = join(dir, "g.mjs");
const ran = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
ran(process.execPath, [lab, "compile", folder, "-o", js]);

test("greenhouse: 200 ticks of 300 moths, evaluated and compiled, the lamp hung at 199", () => {
  const want = ran(process.execPath, [lab, "run", folder, "200", "300"]);
  assert.match(want, /^tick 0: moths 300, plants 24, eaten 0, checksum /);
  assert.equal(ran(process.execPath, [js, "200", "300"]), want);
});

test("greenhouse: 900 ticks of 2000 moths, compiled and native, plants eaten", () => {
  const want = ran(process.execPath, [js, "900", "2000"]);
  assert.match(want, /tick 900: moths 2000, plants 18, eaten 6, /);
  if (skip) return;
  ran(process.execPath, [lab, "native", folder, "-o", join(dir, "g")]);
  assert.equal(ran(join(dir, "g"), ["900", "2000"]), want);
});

test("greenhouse native: a moth read by number for `met` is lent, its stand-in made only past the end (C265, C268)", () => {
  if (skip) return;
  const out = join(dir, "lent");
  ran(process.execPath, [lab, "native", folder, "-o", out]);
  const c = ran("cat", [`${out}.c`]);
  const loop = /static Flock lab_gathered_from_b\([^)]*\) \{[^]*?\n}\n/.exec(c)![0];
  assert.match(loop, /lab_array_peek_a\d+\(p0, /, "the moth read as it is in the array");
  assert.doesNotMatch(loop, /item_at|Thing_dup/, "no call to item at and no count taken");
  assert.match(loop, /\} else \{[^}]*lab_nothing\(\)/, "the stand-in only past the end");
});

test("greenhouse native: the pool's update, its map calling the function its caller gives, runs on threads (C266)", () => {
  if (skip) return;
  const out = join(dir, "threads");
  ran(process.execPath, [lab, "native", folder, "-o", out]);
  const c = ran("cat", [`${out}.c`]);
  // Its pool in tables of slots (G4): each slots' update, the copy made
  // for each system too, whose function comes in through the tables' walk
  // passing it on to itself.
  const updates = [...c.matchAll(/static Pool_slots lab_pool_slots_updated\w*\([^)]*\) \{[^]*?\n}\n/g)].map((m) => m[0]);
  assert.ok(updates.length > 1, "the systems' updates");
  for (const u of updates) assert.match(u, /lab_par_map_\d+\(/, u.split("\n")[0]);
});

test("greenhouse JS: a moth read by number at its parts is checked in place, no try, its stand-in made only past the end (C268)", () => {
  const code = ran("cat", [js]);
  const body = code.split(/\n(?= {2}function f\d+\()/).find((f) => /^ {2}function f\d+\((?:l\d+, )*l\d+\) \{\n {4}let [^\n]*\n(?: {4}const [^\n]*\n)* {4}for \(; ; \) \{/.test(f) && f.includes('"met"'));
  assert.ok(body, "the loop gathering moths near a moth");
  assert.doesNotMatch(body, /try \{/, "no attempt left");
  // As rows, or as columns (G1b2).
  assert.match(body, /if \((!\(l\d+ < 0\) && l\d+ < \(|Number\.isInteger\()/, "the position checked");
  assert.doesNotMatch(body.split("for (; ; )")[1].split(/(?:let|const) t0/)[0], /f\d+\(\);/, "no stand-in made before the check");
});
