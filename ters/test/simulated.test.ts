// Deterministic schedules (BACKLOG L63, LANGUAGE-NEEDS Part 1
// "Deterministic testing"): `simulated(seed, action)` answers Await from a
// virtual clock, so a day's timer takes no time, and breaks ties between
// tickets ready at the same moment with Random seeded by `seed`. The same
// seed gives the same schedule every run; another seed may give another,
// which is how a test finds an interleaving that goes wrong. It is a
// handler written in the language, keeping its clock as the rests resume,
// which needs a case for an operation answered later that answers at once
// (`together`'s `start timer`) beside one that keeps the rest.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { AWAIT_OP, START_TIMER_OP, S, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { compile } from "../../compiler/src/compile.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { makeRunner } from "../src/lang/run.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

// Each action waits on a timer and gives its name.
function program(seed: number, actions: [string, number][], how = "together") {
  const k = new Lang(LIBRARY.code);
  const step = (name: string, ms: number) => k.thunk(() => k.let("t", k.call(START_TIMER_OP, k.lit(ms)), (t) => k.seq(k.call(AWAIT_OP, t), k.lit(name))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(lib("simulated"), k.lit(seed), k.thunk(() => k.call(lib(how), k.list(...actions.map(([n, ms]) => step(n, ms))))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const printed: string[] = [];
  // A world that would really wait: a simulated run never asks it.
  const world = { now: () => 0, wait: () => assert.fail("a simulated run waited for real") };
  runMain(code, info, main, { print: (s) => printed.push(s), names, world } as Parameters<typeof runMain>[3]);
  return printed;
}

test("simulated: timers on a virtual clock, the soonest first, a day's wait taking no time", () => {
  assert.deepEqual(program(1, [["day", 86_400_000], ["second", 1000]]), ['["day", "second"]']);
  assert.deepEqual(program(1, [["day", 86_400_000], ["second", 1000]], "race"), ['"second"']);
});

// Three actions ready at the same moment: which wins the race is the
// scheduler's choice, so the seed's.
test("simulated: ties go by the seed, the same every run, and some seed gives another winner", () => {
  const three: [string, number][] = [["a", 10], ["b", 10], ["c", 10]];
  const winner = (seed: number) => program(seed, three, "race")[0];
  assert.equal(winner(7), winner(7));
  const seen = new Set(Array.from({ length: 12 }, (_, i) => winner(i + 1)));
  assert.ok(seen.size > 1, `one winner for every seed: ${[...seen]}`);
  // Whatever the order, together gives the values in the actions' order.
  assert.deepEqual(program(3, three), ['["a", "b", "c"]']);
});

// The same schedules compiled: the handler keeps its clock in the rests
// there too (generators, C40), and the seed draws the same numbers.
test("simulated compiled to JavaScript picks what the evaluator picks, seed by seed", async () => {
  const k = new Lang(LIBRARY.code);
  const step = (name: string) => k.thunk(() => k.let("t", k.call(START_TIMER_OP, k.lit(10)), (t) => k.seq(k.call(AWAIT_OP, t), k.lit(name))));
  const winner = k.def("winner");
  k.define(winner, k.fn(["seed"], (seed) => k.call(SHOW_ANY, k.call(lib("simulated"), seed, k.thunk(() => k.call(lib("race"), k.list(step("a"), step("b"), step("c"))))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const path = join(mkdtempSync(join(tmpdir(), "simulated-")), "simulated.js");
  writeFileSync(path, compile(code, info, names, { runtime: pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href, exports: ["winner"] }));
  const compiled = (await import(pathToFileURL(path).href)).defs.winner as (seed: number) => string;
  const r = makeRunner(code, info, { print: () => {}, names });
  for (let seed = 1; seed <= 8; seed++) assert.equal(compiled(seed), [...(r.call(r.value(winner), seed) as Iterable<unknown>)][0], `seed ${seed}`);
});

// Await and Random are answered; an Abort (a ticket from another world)
// passes out.
test("the type of simulated: Await is answered, Random seeded", () => {
  const code = base(LIBRARY.code), names = baseNames(LIBRARY.names), info = infer(code, names);
  assert.equal(showType(info.typeOf.get(lib("simulated"))!, names), "(Float64, () -[Abort, Await, Random, e]-> a) -[Abort, e]-> a");
});
