// P10 as a check (T17, main-red.ts): a pull request fails it while Check
// main has been red for more than an hour, unless it names a failing file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { failingIn, verdict, type Run } from "./main-red.ts";

const now = new Date("2026-11-23T12:00:00Z");
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60000).toISOString();
const run = (conclusion: string | null, minutesAgo: number): Run => ({ conclusion, updatedAt: at(minutesAgo) });
const failing = ["ters/test/units-in-types.test.ts", "compiler/test/branches.test.ts"];

test("green, or red under an hour, merges", () => {
  assert.equal(verdict([run("success", 5), run("failure", 90)], failing, "E300: a thing", now).ok, true);
  assert.equal(verdict([], failing, "x", now).ok, true);
  // Red since the first failure after the last green run: 40 minutes.
  const v = verdict([run("failure", 10), run("cancelled", 20), run("failure", 40), run("success", 50)], failing, "E300", now);
  assert.equal(v.ok, true);
  assert.match(v.say, /40 min/);
});

test("red over an hour stops a pull request that names no failing file", () => {
  const runs = [run("failure", 5), run("cancelled", 30), run("failure", 61), run("success", 200)];
  const v = verdict(runs, failing, "E300: a thing", now);
  assert.equal(v.ok, false);
  assert.match(v.say, /61 min/);
  assert.match(v.say, /units-in-types\.test\.ts/);
  // With no green run in the list, red since the oldest failure.
  assert.equal(verdict([run("failure", 5), run("failure", 300)], failing, "x", now).ok, false);
});

test("a fix that names a failing file merges, by its path or its name", () => {
  const runs = [run("failure", 5), run("failure", 120)];
  assert.equal(verdict(runs, failing, "units-in-types.test.ts: the MCP reads a name first", now).ok, true);
  assert.equal(verdict(runs, failing, "fix compiler/test/branches.test.ts", now).ok, true);
  assert.equal(verdict(runs, failing, "branches: a fix", now).ok, false);
});

test("a red run with no failing file in the map doesn't stop merges", () => {
  assert.equal(verdict([run("failure", 5), run("failure", 120)], [], "x", now).ok, true);
});

test("what fails is what the map says didn't pass", () => {
  const e = (passed: boolean) => ({ at: "abc", ran: "2026-11-23", passed, seconds: 1 }) as never;
  assert.deepEqual(failingIn({ tests: { "b.test.ts": e(false), "a.test.ts": e(true), "c.test.ts": e(false) } }), ["b.test.ts", "c.test.ts"]);
});
