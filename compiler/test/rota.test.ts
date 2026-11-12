// rota (compiler/gaps/rota), GAPS.md round 14's program: a staff rota
// found by a Choice search (one of, first, count, optional), the place
// with the fewest options filled first and a branch given up as soon as a
// place has nobody. The evaluator, the core IR's module and the
// hand-written ideal must print the same and exit the same way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { folder, plan, ways } from "../gaps/rota.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>, slow = false) => {
  const want = w.ideal(args, files);
  for (const way of slow ? (["core"] as const) : (["evaluator", "core"] as const)) assert.deepEqual(w[way](args, files), want, way);
  return want;
};
const sample = readFileSync(join(folder, "plan.txt"), "utf8");

test("rota: the sample plan", () => {
  const r = all(["p.txt"], { "p.txt": sample });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.slice(0, 3), ["7 days, 3 shifts, 9 people, 35 places to fill", "fairest: nobody works more than 4 shifts", "     early    late     night"]);
  assert.deepEqual(r.out.slice(-4, -1), ["ways to staff Mon: 480", "needed: nobody", "spare: Ada, Ben, Cy, Dee, Eli, Fay, Gus, Hal, Ivy"]);
});

test("rota: a rest rule, someone needed, and no rota at all", () => {
  const three = "days Mon Tue Wed\nshift n 1\nshift e 1\nperson A 3 n e\nperson B 3 n e\nrest n e\n";
  assert.deepEqual(all(["p"], { p: three }).out.slice(1, 5), ["fairest: nobody works more than 3 shifts", "     n  e", "Mon  A  B", "Tue  A  B"]);
  const r = all(["p"], { p: three.replace("person B 3", "person B 1") });
  assert.deepEqual(r, { out: ["3 days, 2 shifts, 2 people, 6 places to fill"], err: ["rota: no rota can be made from this plan"], code: 1 });
});

test("rota: what goes wrong, and the exit codes", () => {
  assert.deepEqual(all([], {}), { out: [], err: ["usage: rota plan.txt"], code: 2 });
  assert.deepEqual(all(["nope"], {}), { out: [], err: ["rota: no such file or folder: nope"], code: 1 });
  const err = (text: string) => all(["p"], { p: text }).err;
  const base = "days Mon Tue\nshift a 1\nperson X 2 a\nperson Y 2 a\n";
  assert.deepEqual(err("\n# x\n"), ["rota: the plan has no days line"]);
  assert.deepEqual(err("days A\ndays B\n"), ["rota: line 2: the days are given again"]);
  assert.deepEqual(err("days A A\n"), ["rota: line 1: A is a day twice"]);
  assert.deepEqual(err("days A\n"), ["rota: the plan has no shifts"]);
  assert.deepEqual(err("days A\nshift a 1\n"), ["rota: the plan has no people"]);
  assert.deepEqual(err(base + "shift a 2\n"), ["rota: line 5: a is a shift again (first on line 2)"]);
  assert.deepEqual(err(base + "person X 1 a\n"), ["rota: line 5: X is a person again (first on line 3)"]);
  assert.deepEqual(err(base + "person Z 1 b\n"), ["rota: line 5: Z can work b, which isn't a shift"]);
  assert.deepEqual(err(base + "off W Mon\n"), ["rota: line 5: W isn't a person"]);
  assert.deepEqual(err(base + "off X Wed\n"), ["rota: line 5: Wed isn't a day"]);
  assert.deepEqual(err(base + "rest a b\n"), ["rota: line 5: b isn't a shift"]);
  assert.deepEqual(err(base + "shift b 0\n"), ["rota: line 5: a shift needs at least one person"]);
  assert.deepEqual(err(base + "person Q -0 a\n"), ["rota: line 5: most -0 isn't a whole number"]);
  for (const bad of ["person Q 3\n", "off X\n", "rest a\n", "  # not a comment\n", "hello\n"]) assert.deepEqual(err(base + bad), ["rota: line 5: expected days, shift, person, off or rest"]);
});

test("rota: a made-up fortnight of 12 people, from the core IR", () => {
  const r = all(["p"], { p: plan(14, 12) }, true);
  assert.equal(r.out[0], "14 days, 3 shifts, 12 people, 70 places to fill");
});
