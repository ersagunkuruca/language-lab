// crew (compiler/gaps/crew), GAPS.md round 11's program: a plan of tasks
// sorted (Kahn), its critical path found, and a crew of workers, each a
// fiber answered later by a scheduler written in the language, run in
// simulated minutes. The evaluator, the compiled module, the core IR's
// and the hand-written ideal must print the same and exit the same way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { folder, plan, ways } from "../gaps/crew.ts";

const w = await ways();
const all = (args: string[], files: Record<string, string>, slow = false) => {
  const want = w.ideal(args, files);
  for (const way of slow ? (["compiled", "core"] as const) : (["evaluator", "compiled", "core"] as const)) assert.deepEqual(w[way](args, files), want, way);
  return want;
};
const sample = readFileSync(join(folder, "plan.txt"), "utf8");

test("crew: the sample plan", () => {
  const r = all(["p.txt"], { "p.txt": sample });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.slice(0, 4), [
    "7 tasks, 9 links, 37 minutes of work",
    "critical path: fetch → compile-core → test → package (23 minutes)",
    "slack: compile-ui 4, docs 14, lint 16",
    "with 2 workers, critical first: done at 23 minutes",
  ]);
  assert.deepEqual(r.out.slice(-4), ["workers              1     2     3     4", "critical first      37    23    23    23", "in file order       37    23    23    23", "lower bound         37    23    23    23"]);
});

test("crew: ties, zero minutes, a need named twice, one worker", () => {
  all(["p"], { p: "a 0\nb 0 after a\nc 5 after a a\nd 5\nworkers 1\n" });
  const r = all(["p"], { p: "x 5\ny 5\nz 5 after x y\nw 5 after x\nv 1 after w z\nworkers 3\n" });
  assert.equal(r.out[1], "critical path: x → w → v (11 minutes)");
});

test("crew: what goes wrong, and the exit codes", () => {
  assert.deepEqual(all([], {}), { out: [], err: ["usage: crew plan.txt"], code: 2 });
  assert.deepEqual(all(["nope"], {}), { out: [], err: ["crew: no such file or folder: nope"], code: 1 });
  const err = (text: string) => all(["p"], { p: text }).err;
  assert.deepEqual(err("\n# x\n"), ["crew: the plan has no tasks"]);
  const bad = "crew: line 2: expected <task> <minutes> [after <task>…] or workers <n>";
  assert.deepEqual(err("a 1\nb\n"), [bad]);
  assert.deepEqual(err("a 1\nb 1 after\n"), [bad]);
  assert.deepEqual(err("a 1\nb 1 before a\n"), [bad]);
  assert.deepEqual(err("a 1.5\n"), ["crew: line 1: minutes 1.5 isn't a whole number"]);
  assert.deepEqual(err("a -0\n"), ["crew: line 1: minutes -0 isn't a whole number"]);
  assert.deepEqual(err("a 1\na 2\na 3\n"), ["crew: line 2: a is a task again on line 3"]);
  assert.deepEqual(err("a 1\nworkers 0\nworkers 3\nworkers -1\n"), ["crew: line 4: a crew needs at least one worker"]);
  assert.deepEqual(err("a 1 after b\n"), ["crew: line 1: a waits for b, which isn't a task"]);
  assert.deepEqual(err("a 1 after b\nb 1 after a\nc 1\n"), ["crew: these tasks wait for each other: a, b"]);
});

test("crew: a made-up plan of 300 tasks, compiled", () => {
  const r = all(["p"], { p: plan(300, 3) }, true);
  assert.match(r.out[0], /^300 tasks, /);
});
